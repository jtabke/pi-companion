#!/usr/bin/env python3
"""Deterministic real-SIGINT checks at the disposable runner's Python wait boundaries."""
import argparse
from contextlib import redirect_stdout
import errno
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import signal
import sys


def check_interrupt(runner, questionnaire_dir, checkpoint):
    captured = {"process": None, "root": None, "fds": set(), "fired": False}
    original_argv = sys.argv
    original_umask = os.umask(0o027)
    output = io.StringIO()

    def trace(frame, event, _arg):
        if frame.f_code is runner.main.__code__:
            for key in ("process", "root"):
                if frame.f_locals.get(key) is not None:
                    captured[key] = frame.f_locals[key]
            captured["fds"].update(fd for key in ("master", "slave")
                                   if isinstance(fd := frame.f_locals.get(key), int))
        if frame.f_code.co_name == "wait" and frame.f_code.co_filename == runner.__file__:
            owner = frame.f_back.f_locals
            stage = owner["stage"]
            at_ready = checkpoint == "ready" and event == "call" and stage == "ready"
            at_question = checkpoint == "questionnaire" and event == "return" and stage == "actual questionnaire rendering"
            if at_ready or at_question:
                if at_question:
                    records = [json.loads(line) for line in (captured["root"] / "evidence.jsonl").read_text().splitlines()]
                    assert any(r["type"] == "ui_start" and r["kind"] == "custom" for r in records)
                    assert [r["active"] for r in records if r["type"] == "question_blocked"] == [True]
                    assert not any(r["type"] == "question_result" for r in records)
                    assert "C1 fixture: which surface answers?" in re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", owner["terminal"])
                captured["fired"] = True
                sys.settrace(None)
                # A real kernel signal, not a raised/mock KeyboardInterrupt. This
                # traces only our Python runner, never Pi's UI/input or internals.
                os.kill(os.getpid(), signal.SIGINT)
        return trace

    try:
        sys.argv = [runner.__file__, "--questionnaire-dir", str(questionnaire_dir)]
        with redirect_stdout(output):
            sys.settrace(trace)
            try:
                code = runner.main()
            finally:
                sys.settrace(None)
        report = json.loads(output.getvalue())
        assert captured["fired"] and code == 130
        assert report["verdict"] == "interrupted" and report["errorType"] == "KeyboardInterrupt"
        assert report["stage"] == ("ready" if checkpoint == "ready" else "actual questionnaire rendering")
        assert report["cleanupErrors"] == []
        assert all(report[key] for key in ("childReaped", "ptyClosed", "runtimeRemoved", "umaskRestored"))
        assert captured["process"] is not None and captured["process"].returncode is not None
        try:
            os.waitpid(captured["process"].pid, os.WNOHANG)
        except ChildProcessError:
            pass  # Independent evidence: no unreaped owned child remains.
        else:
            raise AssertionError("owned child was not reaped")
        assert not captured["root"].exists()
        assert len(captured["fds"]) == 2
        for fd in captured["fds"]:
            try:
                os.fstat(fd)
            except OSError as error:
                assert error.errno == errno.EBADF
            else:
                raise AssertionError("PTY descriptor remains open")
        assert os.umask(0o027) == 0o027
        assert str(captured["root"]) not in output.getvalue()
        assert str(questionnaire_dir) not in output.getvalue()
        return {"checkpoint": checkpoint, "signal": "SIGINT", "runnerExit": code,
                "errorType": report["errorType"], "childReaped": True, "ptyClosed": True,
                "runtimeRemoved": True, "umaskRestored": True, "independentChecks": True}
    finally:
        sys.settrace(None)
        sys.argv = original_argv
        # Backup cleanup only after assertions, so a regression fails rather than
        # being hidden by harness cleanup. Each test also restores its own umask.
        fds = list(captured["fds"])
        try:
            runner.cleanup_runtime(captured["process"], fds[0] if fds else None,
                                   fds[1] if len(fds) > 1 else None, captured["root"], original_umask)
        finally:
            os.umask(original_umask)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--questionnaire-dir", required=True, type=Path)
    args = parser.parse_args()
    path = Path(__file__).with_name("run-c1.py")
    spec = importlib.util.spec_from_file_location("c1_runner", path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    results = []
    for checkpoint in ("ready", "questionnaire"):
        try:
            results.append(check_interrupt(runner, args.questionnaire_dir.resolve(), checkpoint))
        except Exception as error:
            print(json.dumps({"verdict": "failed", "checkpoint": checkpoint,
                              "errorType": type(error).__name__}))
            return 1
    print(json.dumps({"verdict": "passed", "interruptChecks": results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
