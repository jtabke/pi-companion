#!/usr/bin/env python3
"""Run only the disposable real-Pi C1 check; never submit an ordinary prompt."""
import argparse
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time
import uuid


def cleanup_runtime(process, master, slave, root, old_umask):
    """Release owned resources before touching the run's result bookkeeping."""
    cleanup = {"childReaped": process is None, "ptyClosed": True,
               "runtimeRemoved": root is None, "umaskRestored": False, "cleanupErrors": []}
    try:
        if process is not None:
            try:
                if process.poll() is None:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass  # The child may have exited between poll and kill.
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        process.wait(timeout=3)
                cleanup["childReaped"] = process.poll() is not None
            except (OSError, subprocess.TimeoutExpired) as error:
                cleanup["cleanupErrors"].append("child:" + type(error).__name__)
    finally:
        try:
            for fd in (master, slave):
                if fd is not None:
                    try:
                        os.close(fd)
                    except OSError as error:
                        if error.errno != errno.EBADF:
                            cleanup["ptyClosed"] = False
                            cleanup["cleanupErrors"].append("pty:" + type(error).__name__)
        finally:
            try:
                if root is not None:
                    try:
                        shutil.rmtree(root)
                    except FileNotFoundError:
                        pass
                    except OSError as error:
                        cleanup["cleanupErrors"].append("runtime:" + type(error).__name__)
                    cleanup["runtimeRemoved"] = not root.exists()
            finally:
                os.umask(old_umask)
                cleanup["umaskRestored"] = True
    return cleanup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--questionnaire-dir", required=True, type=Path,
                        help="Existing installed @juicesharp/rpiv-ask-user-question directory")
    args = parser.parse_args()
    executable = shutil.which("pi")
    if not executable:
        parser.error("pi must already be installed and on PATH")
    try:
        # Both dist/cli.js and dist/bundle/cli.js installations exist.
        package = next(parent for parent in Path(executable).resolve().parents
                       if (parent / "package.json").is_file())
        pi_meta = json.loads((package / "package.json").read_text())
        question_dir = args.questionnaire_dir.resolve()
        question_meta = json.loads((question_dir / "package.json").read_text())
        if not (question_dir / "index.ts").is_file() or not shutil.which("node"):
            raise ValueError("missing prerequisite")
    except (OSError, ValueError, StopIteration):
        parser.error("cannot discover existing Pi/Node/questionnaire prerequisites")
    if pi_meta["name"] != "@earendil-works/pi-coding-agent" or question_meta["name"] != "@juicesharp/rpiv-ask-user-question":
        parser.error("unexpected installed package identity")
    if pi_meta["version"] not in {"0.99.1", "0.99.2"} or question_meta["version"] != "2.11.0":
        parser.error("probe reviewed only for Pi 0.99.1/0.99.2 and questionnaire 2.11.0")

    old_umask = os.umask(0o077)
    root = None
    process = None
    master = slave = None
    stage = "setup"
    result = None
    exit_code = 1
    try:
        root = Path(tempfile.mkdtemp(prefix="pi-c1-"))
        for directory in ["home", "agent", "cwd", "config", "sessions", "tmp"]:
            (root / directory).mkdir(mode=0o700)
        assert all(path.stat().st_mode & 0o777 == 0o700 for path in [root, *root.iterdir()])
        template = Path(__file__).with_name("c1-extension.ts").read_text()
        (root / "probe.ts").write_text(template.replace("__QUESTIONNAIRE_ENTRY__", json.dumps(str(question_dir / "index.ts"))))
        tag = "c1-" + uuid.uuid4().hex
        # Construct rather than copy the ambient environment: no provider keys,
        # auth commands, global config, Node preload hooks, or inherited Pi markers.
        env = {
            "PATH": os.defpath + os.pathsep + str(Path(executable).parent) + os.pathsep + str(Path(shutil.which("node")).parent),
            "HOME": str(root / "home"), "XDG_CONFIG_HOME": str(root / "config"),
            "TMPDIR": str(root / "tmp"), "TERM": "xterm-256color", "LANG": "en_US.UTF-8",
            "PI_CODING_AGENT_DIR": str(root / "agent"), "PI_CODING_AGENT_SESSION_DIR": str(root / "sessions"),
            "PI_OFFLINE": "1", "PI_SKIP_VERSION_CHECK": "1", "PI_TELEMETRY": "0",
            "PI_IMAGE_PROTOCOL": "none", "C1_RUNTIME": str(root), "C1_TAG": tag,
        }
        command = [executable, "--offline", "--no-session", "--no-approve", "--no-extensions",
                   "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
                   "--no-tools", "--extension", str(root / "probe.ts")]
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

        def own_terminal():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        process = subprocess.Popen(command, cwd=root / "cwd", env=env,
                                   stdin=slave, stdout=slave, stderr=slave, preexec_fn=own_terminal)
        os.close(slave)
        slave = None
        terminal = ""
        deadline = time.monotonic() + 45

        def evidence():
            file = root / "evidence.jsonl"
            if not file.exists():
                return []
            lines = file.read_text().splitlines()
            # Ignore a partially written final line until the next poll.
            records = []
            for line in lines:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    break
            return records

        def drain():
            nonlocal terminal
            if select.select([master], [], [], 0.05)[0]:
                try:
                    data = os.read(master, 65536)
                    terminal = (terminal + data.decode("utf-8", errors="replace"))[-131072:]
                except OSError:
                    pass

        def wait(predicate):
            while time.monotonic() < deadline:
                drain()
                if predicate(evidence()):
                    return
                if process.poll() is not None:
                    raise RuntimeError("Pi exited before expected evidence")
            raise TimeoutError("bounded TUI check timed out")

        def send(text):
            os.write(master, (text + "\r").encode())

        stage = "ready"
        wait(lambda records: any(r["type"] == "ready" for r in records))
        ready = next(r for r in evidence() if r["type"] == "ready")
        assert ready == {"type": "ready", "mode": "tui", "hasUI": True, "toolCaptured": True,
                         "sessionIdAvailable": True, "ephemeral": True, "branchAvailable": True}
        stage = "external input"
        (root / "deliver").touch(mode=0o600)
        wait(lambda records: any(r["type"] == "input_handled" and r["label"] == "external" for r in records))
        stage = "terminal input before questionnaire"
        send(tag + ":terminal-before")
        wait(lambda records: any(r.get("label") == "terminal-before" for r in records))
        stage = "actual questionnaire rendering"
        send("/c1-question")
        wait(lambda records: any(r["type"] == "ui_start" and r["kind"] == "custom" for r in records)
             and "C1 fixture: which surface answers?" in re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", terminal))
        stage = "terminal answer"
        send("")  # Normal Enter on the published questionnaire's first option.
        wait(lambda records: any(r["type"] == "question_result" for r in records))
        stage = "terminal input after questionnaire"
        send(tag + ":terminal-after")
        wait(lambda records: any(r.get("label") == "terminal-after" for r in records))
        stage = "shutdown"
        send("/c1-finish")
        wait(lambda records: any(r["type"] == "shutdown" for r in records))
        process.wait(timeout=5)
        assert process.returncode == 0
        records = evidence()
        receipts = [r for r in records if r["type"] == "input_handled"]
        assert [(r["label"], r["source"], r["imageCount"]) for r in receipts] == [
            ("external", "extension", 1), ("terminal-before", "interactive", 0), ("terminal-after", "interactive", 0)]
        assert receipts[0]["imageMatches"] is True
        assert [r for r in records if r["type"] == "send_return"] == [{"type": "send_return", "isUndefined": True}]
        prompts = [r for r in records if r["type"] == "question_prompt"]
        assert len(prompts) == 1
        option = prompts[0]["payload"]["questions"][0]["options"][0]
        assert option["hasPreview"] is True and "preview" not in option
        assert [r["active"] for r in records if r["type"] == "question_blocked"] == [True, False]
        assert [(r["type"], r["kind"]) for r in records if r["type"] in ("ui_start", "ui_end")] == [
            ("ui_start", "custom"), ("ui_end", "custom")]
        answers = [r["details"] for r in records if r["type"] == "question_result"]
        assert len(answers) == 1 and answers[0]["cancelled"] is False
        assert answers[0]["answers"][0]["answer"] == "Terminal"
        finished = next(r for r in records if r["type"] == "finished")
        assert finished["counters"] == {"beforeAgentStart": 0, "agentStart": 0, "providerRequest": 0}
        assert finished["nativeUserMessages"] == 0 and finished["pending"] is False
        assert not list((root / "sessions").rglob("*.jsonl"))
        result = {"verdict": "completed", "piVersion": pi_meta["version"], "questionnaireVersion": question_meta["version"],
                  "piExit": process.returncode, "realTUI": True, "questionRendered": True,
                  "handledInputs": receipts, "sendReturnedUndefined": True,
                  "questionPromptCount": len(prompts), "questionBlocked": [True, False],
                  "uiPromptKinds": ["custom", "custom"], "terminalAnswer": "Terminal",
                  "finished": finished, "sessionFiles": 0, "ownerOnlyRuntime": True}
        exit_code = 0
    except KeyboardInterrupt:
        result = {"verdict": "interrupted", "stage": stage, "errorType": "KeyboardInterrupt"}
        exit_code = 130
    except Exception as error:
        # Do not print exception messages or raw TUI output (may contain local paths).
        result = {"verdict": "blocked", "stage": stage, "errorType": type(error).__name__}
    finally:
        # A second Ctrl+C must not interrupt cleanup. Other fatal exceptions still
        # propagate after the nested finally boundaries release remaining resources.
        previous_handler = signal.signal(signal.SIGINT, signal.SIG_IGN)
        try:
            cleanup = cleanup_runtime(process, master, slave, root, old_umask)
        finally:
            signal.signal(signal.SIGINT, previous_handler)
        if result is not None:
            result.update(cleanup)
            if cleanup["cleanupErrors"] or not all(cleanup[key] for key in
                    ("childReaped", "ptyClosed", "runtimeRemoved", "umaskRestored")):
                exit_code = 1
    print(json.dumps(result, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
