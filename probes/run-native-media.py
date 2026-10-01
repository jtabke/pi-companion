#!/usr/bin/env python3
"""Disposable C1-M real-TUI native read/persistence probe; no network provider."""
import argparse
from contextlib import redirect_stdout
import errno
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
import uuid
import zlib

# Reuse the reviewed ownership boundary, without changing the earlier probe.
_spec = importlib.util.spec_from_file_location("c1_cleanup", Path(__file__).with_name("run-c1.py"))
_cleanup_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_cleanup_module)
cleanup_runtime = _cleanup_module.cleanup_runtime


def fixture_png():
    """One deterministic opaque red pixel, not a captured screenshot."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    # Fixed zlib bytes for filter=0, RGB=(255,0,0); no encoder/version dependence.
    pixel = bytes.fromhex("789c63f8cfc0000003010100")
    assert zlib.decompress(pixel) == b"\x00\xff\x00\x00"
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", pixel) + chunk(b"IEND", b""))


def release(process, master, slave, root, umask):
    previous = signal.signal(signal.SIGINT, signal.SIG_IGN)
    try:
        return cleanup_runtime(process, master, slave, root, umask)
    finally:
        signal.signal(signal.SIGINT, previous)


def run_probe(executable, package, node):
    old_umask = os.umask(0o077)
    root = process = master = slave = None
    stage = "setup"
    result = None
    code = 1
    owners = []
    try:
        root = Path(tempfile.mkdtemp(prefix="pi-c1m-"))
        for name in ("home", "config", "agent", "sessions", "cwd", "tmp", "runtime", "node_modules"):
            (root / name).mkdir(mode=0o700)
        scope = root / "node_modules" / "@earendil-works"
        scope.mkdir(mode=0o700)
        # Root exports only. No dependency installation or private-file import.
        (scope / "pi-coding-agent").symlink_to(package, target_is_directory=True)
        ai = package / "node_modules" / "@earendil-works" / "pi-ai"
        assert json.loads((ai / "package.json").read_text())["name"] == "@earendil-works/pi-ai"
        (scope / "pi-ai").symlink_to(ai, target_is_directory=True)
        (root / "probe.ts").write_text(Path(__file__).with_name("native-media-extension.ts").read_text())
        fixture = fixture_png()
        fixture_hash = hashlib.sha256(fixture).hexdigest()
        (root / "cwd" / "fixture.png").write_bytes(fixture)
        (root / "agent" / "settings.json").write_text(json.dumps({
            "retry": {"enabled": False, "provider": {"maxRetries": 0}},
            "compaction": {"enabled": False}, "cacheWarming": "off",
            "enableInstallTelemetry": False, "enableAnalytics": False,
        }))
        tag = "c1m-" + uuid.uuid4().hex
        env = {
            "PATH": os.defpath + os.pathsep + str(Path(executable).parent) + os.pathsep + str(Path(node).parent),
            "HOME": str(root / "home"), "XDG_CONFIG_HOME": str(root / "config"),
            "TMPDIR": str(root / "tmp"), "TERM": "xterm-256color", "LANG": "en_US.UTF-8",
            "PI_CODING_AGENT_DIR": str(root / "agent"), "PI_CODING_AGENT_SESSION_DIR": str(root / "sessions"),
            "PI_OFFLINE": "1", "PI_SKIP_VERSION_CHECK": "1", "PI_TELEMETRY": "0", "PI_IMAGE_PROTOCOL": "none",
            "C1M_RUNTIME": str(root), "C1M_TAG": tag,
        }
        base_command = [executable, "--offline", "--no-approve", "--no-extensions", "--no-skills",
                        "--no-prompt-templates", "--no-themes", "--no-context-files", "--tools", "read",
                        "--provider", "c1m-disposable-script", "--model", "fixed", "--thinking", "off",
                        "--extension", str(root / "probe.ts")]
        first_branch = None
        session_file = None
        for phase in ("first", "reopen"):
            stage = phase + " launch"
            command = base_command + (["--session", str(session_file)] if phase == "reopen" else [])
            env["C1M_PHASE"] = phase
            master, slave = pty.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

            def own_terminal():
                os.setsid()
                fcntl.ioctl(0, termios.TIOCSCTTY, 0)

            process = subprocess.Popen(command, cwd=root / "cwd", env=env, stdin=slave, stdout=slave,
                                       stderr=slave, preexec_fn=own_terminal)
            os.close(slave)
            slave = None
            terminal = b""
            deadline = time.monotonic() + 45

            def evidence():
                path = root / (phase + "-evidence.json")
                if not path.exists():
                    return []
                assert path.stat().st_size <= 65536
                records = json.loads(path.read_text())
                assert len(records) <= 64
                if any(record["type"] in ("failure", "stream_error") for record in records):
                    raise AssertionError("extension rejected probe")
                return records

            def wait(predicate):
                nonlocal terminal
                while time.monotonic() < deadline:
                    if select.select([master], [], [], 0.05)[0]:
                        try:
                            terminal = (terminal + os.read(master, 65536))[-131072:]
                        except OSError as error:
                            if error.errno != errno.EIO:
                                raise
                    if predicate(evidence()):
                        return
                    if process.poll() is not None:
                        raise RuntimeError("owner exited before evidence")
                raise TimeoutError("bounded TUI wait")

            def send(text):
                os.write(master, (text + "\r").encode())

            stage = phase + " ready"
            wait(lambda records: any(record["type"] == "ready" for record in records))
            ready = next(record for record in evidence() if record["type"] == "ready")
            assert ready["realTUI"] is True and ready["fixtureSha256"] == fixture_hash
            if phase == "reopen":
                assert ready["branch"] == first_branch
            stage = phase + " terminal before"
            send(tag + ":terminal-before")
            wait(lambda records: any(record.get("label") == "terminal-before" for record in records))
            if phase == "first":
                stage = "native turn"
                send("/c1m-read")
                wait(lambda records: any(record["type"] == "settled" for record in records))
                settled = next(record for record in evidence() if record["type"] == "settled")
                assert settled["requests"] == 2 and settled["toolCalls"] == 1
                first_branch = settled["branch"]
            stage = phase + " terminal after"
            send(tag + ":terminal-after")
            wait(lambda records: any(record.get("label") == "terminal-after" for record in records))
            stage = phase + " shutdown"
            send("/c1m-finish")
            wait(lambda records: any(record["type"] == "shutdown" for record in records))
            process.wait(timeout=5)
            assert process.returncode == 0
            records = evidence()
            finished = next(record for record in records if record["type"] == "finished")
            assert finished["branch"] == first_branch
            assert finished["requests"] == (2 if phase == "first" else 0)
            assert finished["toolCalls"] == (1 if phase == "first" else 0)
            assert [record["label"] for record in records if record["type"] == "terminal"] == ["terminal-before", "terminal-after"]
            if phase == "first":
                for kind in ("tool_image", "message_image", "provider_image"):
                    images = [record for record in records if record["type"] == kind]
                    assert len(images) == 1
                    assert images[0]["sha256"] == fixture_hash and images[0]["bytes"] == len(fixture)
                    assert images[0]["imageCount"] == 1 and images[0]["mimeType"] == "image/png"
                assert [record["number"] for record in records if record["type"] == "scripted_request"] == [1, 2]
                assert len([record for record in records if record["type"] == "tool_call"]) == 1
                assert [record for record in records if record["type"] == "native_input"] == [{"type": "native_input", "source": "extension"}]
                assert [record for record in records if record["type"] == "dispatch"] == [{"type": "dispatch", "returnedVoid": True}]
            else:
                assert not any(record["type"] in ("dispatch", "native_input", "scripted_request", "tool_call", "tool_image", "message_image", "settled") for record in records)
            session_files = list((root / "sessions").rglob("*.jsonl"))
            assert len(session_files) == 1 and session_files[0].stat().st_size > 0
            session_file = session_files[0]
            # Do not open/read/write the native transcript; only Pi hydrates it.
            for path in [root, *root.rglob("*")]:
                if path.is_symlink():
                    continue  # Read-only package links are not owned runtime content.
                assert path.stat().st_mode & 0o777 == (0o700 if path.is_dir() else 0o600)
            owned = release(process, master, slave, None, 0o077)
            assert owned["cleanupErrors"] == [] and owned["childReaped"] and owned["ptyClosed"]
            owners.append({"phase": phase, "piExit": process.returncode, "requests": finished["requests"],
                           "toolCalls": finished["toolCalls"], "terminalInputs": 2, "childReaped": True, "ptyClosed": True})
            process = master = slave = None
        result = {"verdict": "completed", "piVersion": "0.99.2", "realTUI": True,
                  "fixture": {"kind": "generated PNG, not screenshot", "bytes": len(fixture), "sha256": fixture_hash},
                  "nativeToolEventImage": True, "finalizedMessageImage": True, "activeBranchImage": True,
                  "nativePersistenceReopened": True, "sameEntryIdentitiesAndBytes": True,
                  "reopenWithoutTurn": True, "ownerOnlyRuntime": True, "owners": owners}
        code = 0
    except KeyboardInterrupt:
        result = {"verdict": "interrupted", "stage": stage, "errorType": "KeyboardInterrupt"}
        code = 130
    except Exception as error:
        result = {"verdict": "blocked", "stage": stage, "errorType": type(error).__name__}
    finally:
        cleanup = release(process, master, slave, root, old_umask)
        if result is not None:
            result.update(cleanup)
            if cleanup["cleanupErrors"] or not all(cleanup[key] for key in ("childReaped", "ptyClosed", "runtimeRemoved", "umaskRestored")):
                code = 1
    print(json.dumps(result, indent=2))
    return code


def check_interrupts(executable, package, node):
    """Real SIGINT at Python boundaries only; independent checks before backup cleanup."""
    results = []
    for checkpoint in ("first ready", "native turn"):
        captured = {"process": None, "root": None, "fds": set(), "fired": False}
        old_umask = os.umask(0o027)
        output = io.StringIO()

        def trace(frame, event, _arg):
            if frame.f_code is run_probe.__code__:
                for key in ("root", "process"):
                    if frame.f_locals.get(key) is not None:
                        captured[key] = frame.f_locals[key]
                captured["fds"].update(fd for key in ("master", "slave") if isinstance(fd := frame.f_locals.get(key), int))
            if frame.f_code.co_name == "wait" and frame.f_code.co_filename == __file__:
                at_checkpoint = frame.f_back.f_locals["stage"] == checkpoint
                if at_checkpoint and event == ("call" if checkpoint == "first ready" else "return"):
                    if checkpoint == "native turn":
                        records = json.loads((captured["root"] / "first-evidence.json").read_text())
                        assert any(record["type"] == "settled" for record in records)
                        assert any(record["type"] == "tool_image" for record in records)
                    captured["fired"] = True
                    sys.settrace(None)
                    os.kill(os.getpid(), signal.SIGINT)
            return trace

        try:
            with redirect_stdout(output):
                sys.settrace(trace)
                try:
                    code = run_probe(executable, package, node)
                finally:
                    sys.settrace(None)
            report = json.loads(output.getvalue())
            assert captured["fired"] and code == 130 and report["stage"] == checkpoint
            assert report["errorType"] == "KeyboardInterrupt" and report["cleanupErrors"] == []
            assert all(report[key] for key in ("childReaped", "ptyClosed", "runtimeRemoved", "umaskRestored"))
            assert captured["process"].returncode is not None and not captured["root"].exists()
            try:
                os.waitpid(captured["process"].pid, os.WNOHANG)
            except ChildProcessError:
                pass
            else:
                raise AssertionError("child not reaped")
            assert len(captured["fds"]) == 2
            for fd in captured["fds"]:
                try:
                    os.fstat(fd)
                except OSError as error:
                    assert error.errno == errno.EBADF
                else:
                    raise AssertionError("PTY left open")
            assert os.umask(0o027) == 0o027 and str(captured["root"]) not in output.getvalue()
            results.append({"checkpoint": checkpoint, "runnerExit": code, "signal": "SIGINT",
                            "independentOwnershipChecks": True})
        except Exception as error:
            print(json.dumps({"verdict": "blocked", "checkpoint": checkpoint, "errorType": type(error).__name__}))
            return 1
        finally:
            sys.settrace(None)
            fds = list(captured["fds"])
            release(captured["process"], fds[0] if fds else None, fds[1] if len(fds) > 1 else None, captured["root"], old_umask)
    print(json.dumps({"verdict": "completed", "interruptChecks": results}, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-interrupts", action="store_true", help="Focused runner SIGINT regressions only")
    args = parser.parse_args()
    executable, node = shutil.which("pi"), shutil.which("node")
    if not executable or not node:
        parser.error("existing Pi and Node must be on PATH")
    try:
        package = next(parent for parent in Path(executable).resolve().parents if (parent / "package.json").is_file())
        meta = json.loads((package / "package.json").read_text())
    except (OSError, ValueError, StopIteration):
        parser.error("cannot discover installed Pi package")
    if meta.get("name") != "@earendil-works/pi-coding-agent" or meta.get("version") != "0.99.2":
        parser.error("probe reviewed only for installed Pi 0.99.2; stop for version review")
    return (check_interrupts if args.check_interrupts else run_probe)(executable, package, node)


if __name__ == "__main__":
    raise SystemExit(main())
