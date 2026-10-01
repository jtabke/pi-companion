#!/usr/bin/env python3
"""Source-loaded, no-model Pi 0.99.2 questionnaire reply PTY checks.
Run from the parent project: python3 -B probes/run-questionnaire-replies.py
Add --default-off to verify the unconfigured terminal-only path.
Uses the existing C1 cleanup utility, not its questionnaire/protocol implementation.
"""
import argparse
import fcntl
import importlib.util
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

EXTENSION = r'''
import questionnaire, { ASK_USER_REQUEST_EVENT as REQUEST, ASK_USER_REPLY_EVENT as REPLY,
  ASK_USER_REPLY_OUTCOME_EVENT as OUTCOME, ASK_USER_CLOSED_EVENT as CLOSED } from __ENTRY__;
import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
export default function(pi) {
  const root = process.env.C1_RUNTIME;
  const tag = process.env.C1_TAG;
  const record = (type, data = {}) => appendFileSync(join(root, "evidence.jsonl"),
    JSON.stringify({type, ...data}) + "\n", {mode: 0o600});
  let tool, request, scenario, timer;
  const counters = {beforeAgentStart: 0, agentStart: 0, providerRequest: 0};
  questionnaire({...pi, registerTool(definition) {
    pi.registerTool(definition);
    if (definition.name === "ask_user_question") tool = definition;
  }});
  const removeClient = pi.events.on(REQUEST, payload => {
    request = payload;
    record("request", {scenario, payload});
  });
  pi.events.on(OUTCOME, payload => record("outcome", {scenario, payload}));
  pi.events.on(CLOSED, payload => record("closed", {scenario, payload}));
  pi.on("ui_prompt_start", e => record("ui_start", {kind: e.kind}));
  pi.on("ui_prompt_end", e => record("ui_end", {kind: e.kind}));
  pi.on("before_agent_start", () => { counters.beforeAgentStart++; });
  pi.on("agent_start", () => { counters.agentStart++; });
  pi.on("before_provider_request", () => { counters.providerRequest++; });
  pi.on("input", event => {
    record("input", {text: event.text.startsWith(tag + ":") ? event.text.slice(tag.length + 1) : "unexpected",
      source: event.source});
    return {action: "handled"}; // Every ordinary input is intercepted, never sent to a provider.
  });
  pi.on("session_start", (_e, ctx) => {
    record("ready", {mode: ctx.mode, captured: !!tool, ephemeral: ctx.sessionManager.getSessionFile() === undefined});
    timer = setInterval(() => {
      const file = join(root, "trigger");
      if (!existsSync(file)) return;
      const action = readFileSync(file, "utf8"); unlinkSync(file);
      if (action === "departure") { removeClient(); record("departure"); return; }
      if (!request) throw new Error("No request");
      pi.events.emit(REPLY, {invocationId: request.invocationId, replyId: action, cancelled: false,
        answers: [{questionIndex: action === "invalid" ? 9 : 0, kind: "option", answer: "Browser",
          question: "forged", preview: "forged"}]});
      record("triggered", {action});
    }, 25);
  });
  pi.registerCommand("reply-question", {description: "Direct source tool check (not native dispatch)",
    handler: async (args, ctx) => {
      scenario = args;
      const result = await tool.execute("fixture-" + args, {questions: [{
        question: "Reply fixture: which surface answers?\r", header: "Reply fixture",
        options: [{label: "Terminal", description: "PTY Enter", preview: "terminal preview"},
          {label: "Browser", description: "Public reply", preview: "browser preview\r\ncontent"}]
      }]}, undefined, undefined, ctx);
      record("result", {scenario: args, details: result.details});
    }});
  pi.registerCommand("reply-finish", {description: "Record no-model checks and shut down",
    handler: async (_args, ctx) => {
      record("finished", {counters, pending: ctx.hasPendingMessages(),
        nativeUserMessages: ctx.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").length});
      ctx.shutdown();
    }});
  pi.on("session_shutdown", () => {clearInterval(timer); removeClient(); record("shutdown");});
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--default-off", action="store_true")
    parser.add_argument("--companion", action="store_true", help="Production bridge/gateway/browser with the same no-model TUI")
    args = parser.parse_args()
    if args.companion and args.default_off:
        parser.error("--companion requires explicit source opt-in; use --default-off separately")
    project = Path(__file__).resolve().parent.parent
    question_dir = project / "integrations/rpiv-mono/packages/rpiv-ask-user-question"
    executable = shutil.which("pi")
    node = shutil.which("node")
    if not executable or not node:
        parser.error("existing Pi and Node required")
    package = next(p for p in Path(executable).resolve().parents if (p / "package.json").is_file())
    meta = json.loads((package / "package.json").read_text())
    qmeta = json.loads((question_dir / "package.json").read_text())
    if meta.get("name") != "@earendil-works/pi-coding-agent" or meta.get("version") != "0.99.2" or qmeta.get("version") != "2.11.0":
        parser.error("reviewed only for Pi 0.99.2 and source questionnaire 2.11.0")
    spec = importlib.util.spec_from_file_location("c1_cleanup", Path(__file__).with_name("run-c1.py"))
    cleanup_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cleanup_module)
    old_umask = os.umask(0o077)
    root = process = master = slave = client = client_stderr = None
    client_records = []
    logs = None
    result = None
    code = 1
    stage = "setup"
    try:
        if args.companion:
            logs = Path(tempfile.mkdtemp(prefix="pi-c4d-logs-", dir="/tmp"))
        root = Path(tempfile.mkdtemp(prefix="pi-q-", dir="/tmp" if args.companion else None))
        for name in ["home", "config", "agent", "sessions", "cwd", "tmp"]:
            (root / name).mkdir(mode=0o700)
        assert all(p.stat().st_mode & 0o777 == 0o700 for p in [root, *root.iterdir()])
        if not args.default_off:
            config = root / "config/rpiv-ask-user-question"
            config.mkdir(mode=0o700)
            (config / "config.json").write_text('{"companionReplies":true}')
        template = EXTENSION.replace("__ENTRY__", json.dumps(str(question_dir / "index.ts")))
        if args.companion:
            template = 'import bridge from ' + json.dumps(str(project / "dist/extension/bridge.js")) + ';\n' + template
            template = template.replace('export default function(pi) {', 'export default function(pi) {\n  bridge(pi);')
            template = template.replace('pi.registerCommand("reply-finish",', '''pi.registerCommand("reply-reload", {description: "No-model checks before runtime replacement", handler: async (_args, ctx) => {
    record("before-reload", {counters, pending: ctx.hasPendingMessages(), nativeUserMessages: ctx.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").length}); await ctx.reload();
  }});
  pi.registerCommand("reply-finish",''')
            template = template.replace('if (action === "departure")', '''if (action === "shutdown") {
        record("finished", {counters, pending: ctx.hasPendingMessages(), nativeUserMessages: ctx.sessionManager.getBranch().filter(e => e.type === "message" && e.message.role === "user").length});
        record("triggered", {action}); ctx.shutdown(); return;
      }
      if (action === "departure")''')
        (root / "probe.ts").write_text(template)
        tag = uuid.uuid4().hex
        env = {"PATH": os.defpath + os.pathsep + str(Path(executable).parent) + os.pathsep + str(Path(node).parent),
               "HOME": str(root / "home"), "XDG_CONFIG_HOME": str(root / "config"), "TMPDIR": str(root / "tmp"),
               "PI_CODING_AGENT_DIR": str(root / "agent"), "PI_CODING_AGENT_SESSION_DIR": str(root / "sessions"),
               "TERM": "xterm-256color", "LANG": "en_US.UTF-8", "PI_OFFLINE": "1", "PI_SKIP_VERSION_CHECK": "1",
               "PI_TELEMETRY": "0", "PI_IMAGE_PROTOCOL": "none", "C1_RUNTIME": str(root), "C1_TAG": tag}
        if args.companion:
            (root / "ipc").mkdir(mode=0o700)
            env["C2_RUNTIME"] = str(root / "ipc")
        command = [executable, "--offline", "--no-session", "--no-approve", "--no-extensions", "--no-skills",
                   "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-tools", "--extension", str(root / "probe.ts")]
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        def own_terminal():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        process = subprocess.Popen(command, cwd=root / "cwd", env=env, stdin=slave, stdout=slave, stderr=slave, preexec_fn=own_terminal)
        os.close(slave)
        slave = None
        terminal = ""
        deadline = time.monotonic() + (120 if args.companion else 45)
        def evidence():
            file = root / "evidence.jsonl"
            if not file.exists():
                return []
            assert file.stat().st_size < 65536
            records = []
            for line in file.read_text().splitlines():
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    break
            return records
        def wait(predicate):
            nonlocal terminal
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.05)[0]:
                    try:
                        raw = os.read(master, 65536)
                        terminal = (terminal + raw.decode("utf8", errors="replace"))[-131072:]
                        if logs:
                            with (logs / "terminal.log").open("ab") as output:
                                output.write(raw)
                    except OSError:
                        pass
                if predicate(evidence()):
                    return
                if process.poll() is not None:
                    raise RuntimeError("Pi exited before evidence")
            raise TimeoutError("bounded PTY test")
        def send(text):
            os.write(master, (text + "\r").encode())
        def trigger(action):
            (root / "trigger").write_text(action)
            wait(lambda records: any(r["type"] == ("departure" if action == "departure" else "triggered") and
                 (action == "departure" or r["action"] == action) for r in records))
        stage = "ready"
        wait(lambda rs: any(r["type"] == "ready" for r in rs))
        assert next(r for r in evidence() if r["type"] == "ready") == {"type": "ready", "mode": "tui", "captured": True, "ephemeral": True}
        if args.companion:
            browser_env = {"PATH": env["PATH"], "HOME": str(root / "home"), "TMPDIR": str(root / "tmp"), "PLAYWRIGHT_BROWSERS_PATH": str(project / ".cache/playwright")}
            client_stderr = (logs / "browser-stderr.log").open("w")
            client = subprocess.Popen([node, str(project / "tests/questionnaire-browser.mjs"), str(root / "ipc")], cwd=project, env=browser_env,
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=client_stderr, text=True, bufsize=1)
            def browser_wait():
                while time.monotonic() < deadline:
                    if select.select([client.stdout], [], [], 0.05)[0]:
                        line = client.stdout.readline()
                        if line:
                            record = json.loads(line); client_records.append(record)
                            (logs / "browser.jsonl").write_text("".join(json.dumps(r) + "\n" for r in client_records))
                            assert "error" not in record, record
                            return record
                    # Drain the actual terminal while the browser operates; never let PTY backpressure stall Pi.
                    if select.select([master], [], [], 0)[0]:
                        try:
                            raw = os.read(master, 65536)
                            with (logs / "terminal.log").open("ab") as output:
                                output.write(raw)
                        except OSError:
                            pass
                    if client.poll() is not None:
                        raise RuntimeError("browser client exited")
                raise TimeoutError("bounded browser operation")
            def browser(action):
                client.stdin.write(json.dumps({"action": action}) + "\n"); client.stdin.flush()
                record = browser_wait(); assert record.get("action") == action
                return record["result"]
            assert browser_wait() == {"ready": True}
        scenarios = ["default-off"] if args.default_off else (["external", "terminal", "departure", "restart"] if args.companion else ["external", "terminal", "departure"])
        for scenario in scenarios:
            stage = scenario + " rendering"
            terminal = ""
            send("/reply-question " + scenario)
            wait(lambda rs: "Reply fixture: which surface answers?" in re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", terminal) and
                 (args.default_off or any(r["type"] == "request" and r["scenario"] == scenario for r in rs)))
            if not args.default_off:
                request = next(r["payload"] for r in evidence() if r["type"] == "request" and r["scenario"] == scenario)
                assert request["questions"][0]["question"] == "Reply fixture: which surface answers?"
                assert request["questions"][0]["options"][1]["preview"] == "browser preview\ncontent"
            stage = scenario + " completion"
            if args.companion:
                observed = browser("observe")
                assert observed["request"]["invocationId"] == request["invocationId"]
                if scenario == "external":
                    browser("invalid")
                    assert not any(r["type"] == "result" and r["scenario"] == scenario for r in evidence())
                    browser("answer")
                elif scenario == "restart":
                    browser("restart"); browser("answer")
                else:
                    browser("departure-switch")
                    if scenario == "departure":
                        browser("depart")
                    send("")
            elif scenario == "external":
                trigger("invalid")
                assert not any(r["type"] == "result" for r in evidence())
                trigger("valid")
            else:
                if scenario == "departure":
                    trigger("departure")
                send("")
            wait(lambda rs: any(r["type"] == "result" and r["scenario"] == scenario for r in rs))
            details = next(r["details"] for r in evidence() if r["type"] == "result" and r["scenario"] == scenario)
            expected = "Browser" if scenario in ["external", "restart"] else "Terminal"
            assert details["cancelled"] is False and details["answers"][0]["answer"] == expected
            assert details["answers"][0]["question"] == "Reply fixture: which surface answers?"
            assert details["answers"][0]["preview"] == ("browser preview\ncontent" if scenario in ["external", "restart"] else "terminal preview")
            if not args.default_off:
                closes = [r for r in evidence() if r["type"] == "closed" and r["scenario"] == scenario]
                assert len(closes) == 1 and closes[0]["payload"]["reason"] == ("external" if scenario in ["external", "restart"] else "terminal")
                if args.companion:
                    if scenario == "departure":
                        browser("reopen")
                    prior_outcomes = len([r for r in evidence() if r["type"] == "outcome"])
                    browser("closed-stale")
                    assert len([r for r in evidence() if r["type"] == "outcome"]) == prior_outcomes
                elif scenario != "departure":
                    prior_outcomes = len([r for r in evidence() if r["type"] == "outcome"])
                    trigger("late-" + scenario)
                    assert len([r for r in evidence() if r["type"] == "outcome"]) == prior_outcomes
            stage = scenario + " preserved terminal input"
            send(tag + ":after-" + scenario)
            wait(lambda rs: any(r["type"] == "input" and r["text"] == "after-" + scenario for r in rs))
        stage = "shutdown"
        if args.companion:
            stage = "reload old generation"
            before_ready = len([r for r in evidence() if r["type"] == "ready"])
            send("/reply-reload")
            wait(lambda rs: len([r for r in rs if r["type"] == "ready"]) == before_ready + 1)
            browser("reload-stale")
            # Pending orderly shutdown must close the same overlay, not redirect an old reply.
            send("/reply-question shutdown")
            wait(lambda rs: any(r["type"] == "request" and r["scenario"] == "shutdown" for r in rs))
            trigger("shutdown")
            browser("shutdown")
        else:
            send("/reply-finish")
        wait(lambda rs: any(r["type"] == "shutdown" for r in rs))
        if args.companion:
            stage = "pending shutdown Pi exit"
            wait(lambda rs: process.poll() is not None)
        process.wait(timeout=5)
        assert process.returncode == 0
        records = evidence()
        finished = next(r for r in records if r["type"] == "finished")
        assert finished == {"type": "finished", "counters": {"beforeAgentStart": 0, "agentStart": 0, "providerRequest": 0}, "pending": False, "nativeUserMessages": 0}
        assert all(r["source"] == "interactive" and r["text"] != "unexpected" for r in records if r["type"] == "input")
        assert len([r for r in records if r["type"] == "result" and r["scenario"] != "shutdown"]) == len(scenarios)
        assert len([r for r in records if r["type"] == "ui_end"]) == len(scenarios) + int(args.companion)
        if args.default_off:
            assert not any(r["type"] in ["request", "outcome", "closed"] for r in records)
        else:
            outcomes = [r["payload"] for r in records if r["type"] == "outcome"]
            if args.companion:
                assert [p["accepted"] for p in outcomes] == [False, True, True]
                before_reload = next(r for r in records if r["type"] == "before-reload")
                assert before_reload == {"type": "before-reload", "counters": {"beforeAgentStart": 0, "agentStart": 0, "providerRequest": 0}, "pending": False, "nativeUserMessages": 0}
                assert any(r["type"] == "closed" and r["scenario"] == "shutdown" and r["payload"]["reason"] == "shutdown" for r in records)
            else:
                assert [(p["replyId"], p["accepted"]) for p in outcomes] == [("invalid", False), ("valid", True)]
        assert not list((root / "sessions").rglob("*.jsonl"))
        result = {"verdict": "completed", "piVersion": meta["version"], "sourceVersion": qmeta["version"],
                  "realTUI": True, "piExit": process.returncode, "scenarios": scenarios, "oneResultPerInvocation": True, "terminalInputPreserved": True,
                  "closureAndLateSafety": not args.default_off, "noModel": finished, "sessionFiles": 0, "ownerOnlyRuntime": True}
        if args.companion:
            browser_finish = {"action": "finish"}
            client.stdin.write(json.dumps(browser_finish) + "\n"); client.stdin.flush()
            cleaned = browser_wait(); assert all(cleaned["cleanup"].values())
            client.stdin.close()
            client.wait(timeout=5); assert client.returncode == 0
            result.update({"companion": True, "gatewayRestartPending": True, "oldGenerationSafe": True, "browserCleanup": cleaned["cleanup"], "gatewayExits": cleaned["gatewayExits"], "beforeReloadNoModel": before_reload, "rawLogs": str(logs)})
        code = 0
    except KeyboardInterrupt:
        result = {"verdict": "interrupted", "stage": stage, "errorType": "KeyboardInterrupt"}
        code = 130
    except Exception as error:
        result = {"verdict": "blocked", "stage": stage, "errorType": type(error).__name__}
    finally:
        previous = signal.signal(signal.SIGINT, signal.SIG_IGN)
        try:
            client_cleanup_errors = []
            try:
                if logs and root:
                    if (root / "evidence.jsonl").exists():
                        shutil.copyfile(root / "evidence.jsonl", logs / "native.jsonl")
                    if result is not None:
                        result["rawLogs"] = str(logs)
                if client is not None:
                    if client.poll() is None:
                        client.terminate()
                        try:
                            client.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            client.kill(); client.wait(timeout=5)
                    if result is not None:
                        result["browserChildReaped"] = client.poll() is not None
            except (OSError, subprocess.TimeoutExpired) as error:
                client_cleanup_errors.append("browser-or-evidence:" + type(error).__name__)
            finally:
                try:
                    if client is not None:
                        client.stdin.close(); client.stdout.close()
                    if client_stderr is not None:
                        client_stderr.close()
                finally:
                    cleanup = cleanup_module.cleanup_runtime(process, master, slave, root, old_umask)
                    cleanup["cleanupErrors"].extend(client_cleanup_errors)
        finally:
            signal.signal(signal.SIGINT, previous)
        if result is not None:
            result.update(cleanup)
            if cleanup["cleanupErrors"] or not all(cleanup[k] for k in ["childReaped", "ptyClosed", "runtimeRemoved", "umaskRestored"]):
                code = 1
    print(json.dumps(result, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
