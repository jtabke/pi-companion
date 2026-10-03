#!/usr/bin/env python3
"""Opt-in real TUI checks, including installed-package background survival; local fixed provider only."""
import errno
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pty
import select
import shlex
import shutil
import signal
import struct
import sys
import subprocess
import tempfile
import termios
import time
import traceback
import uuid
import urllib.request

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location('c1_cleanup', REPO / 'probes/run-c1.py')
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
cleanup_runtime = _module.cleanup_runtime


def release(process, master, slave, root, umask):
    previous = signal.signal(signal.SIGINT, signal.SIG_IGN)
    try:
        return cleanup_runtime(process, master, slave, root, umask)
    finally:
        signal.signal(signal.SIGINT, previous)


def main():
    background_mode = sys.argv[1:] == ["--background"]
    image_mode = sys.argv[1:] == ["--image"]
    stop_mode = sys.argv[1:] == ["--stop"]
    input_mode = sys.argv[1:] == ["--input"] or image_mode or stop_mode
    if sys.argv[1:] and not (input_mode or background_mode):
        raise SystemExit("Only explicit --input, --image, --stop or --background mode supported")
    executable, node = shutil.which('pi'), shutil.which('node')
    if not executable or not node:
        raise SystemExit('Existing Pi and Node required')
    package = next(p for p in Path(executable).resolve().parents if (p / 'package.json').exists())
    meta = json.loads((package / 'package.json').read_text())
    if (meta['name'], meta['version']) != ('@earendil-works/pi-coding-agent', '0.99.2'):
        raise SystemExit('Only Pi 0.99.2 reviewed; stop for version review')
    subagents = None
    if background_mode:
        subagents = Path.home() / '.pi/agent/npm/node_modules/pi-subagents'
        subagent_meta = json.loads((subagents / 'package.json').read_text())
        if (subagent_meta['name'], subagent_meta['version']) != ('pi-subagents', '0.73.1') or not all((subagents / entry).is_file() for entry in ('index.js', 'src/runs/background/subagent-runner-bootstrap.js', 'runner-peer-preload.mjs')):
            raise SystemExit('Only installed pi-subagents 0.73.1 reviewed')
    old_umask = os.umask(0o077)
    root = gateway = None
    owners, runners, lifecycle = [], {}, []
    result, code, stage = None, 1, 'setup'
    try:
        root = Path(tempfile.mkdtemp(prefix='c4-background-' if background_mode else 'c4-real-' if input_mode else 'c3-real-', dir='/tmp')).resolve()
        (root / 'ipc').mkdir(mode=0o700)
        base_env = {'PATH': os.defpath + os.pathsep + str(Path(executable).parent) + os.pathsep + str(Path(node).parent),
                    'TERM': 'xterm-256color', 'LANG': 'en_US.UTF-8', 'PI_OFFLINE': '1', 'PI_SKIP_VERSION_CHECK': '1',
                    'PI_TELEMETRY': '0', 'PI_IMAGE_PROTOCOL': 'none', 'C2_RUNTIME': str(root / 'ipc'), 'C2_AUTH_DIR': str(root / 'auth'), 'C2_PORT': '4394',
                    'PLAYWRIGHT_BROWSERS_PATH': str(REPO / '.cache/playwright')}
        for name in (('a',) if input_mode else ('a', 'b')):
            directory = root / name
            directory.mkdir(mode=0o700)
            for leaf in ('home', 'config', 'agent', 'sessions', 'cwd', 'tmp', 'node_modules'):
                (directory / leaf).mkdir(mode=0o700)
            scope = directory / 'node_modules/@earendil-works'
            scope.mkdir(mode=0o700)
            (scope / 'pi-coding-agent').symlink_to(package, target_is_directory=True)
            (scope / 'pi-ai').symlink_to(package / 'node_modules/@earendil-works/pi-ai', target_is_directory=True)
            (directory / 'probe.ts').write_bytes((REPO / ('tests/input-fixture.ts' if input_mode or background_mode else 'probes/native-media-extension.ts')).read_bytes())
            (directory / 'agent/settings.json').write_text(json.dumps({'retry': {'enabled': False, 'provider': {'maxRetries': 0}}, 'compaction': {'enabled': False}, 'cacheWarming': 'off', 'enableInstallTelemetry': False, 'enableAnalytics': False, **({'images': {'autoResize': False}} if image_mode else {})}))
            tag = ('c4-' if input_mode else 'c3-') + uuid.uuid4().hex
            env = {**base_env, 'HOME': str(directory / 'home'), 'XDG_CONFIG_HOME': str(directory / 'config'),
                   'TMPDIR': str(directory / 'tmp'), 'PI_CODING_AGENT_DIR': str(directory / 'agent'),
                   'PI_CODING_AGENT_SESSION_DIR': str(directory / 'sessions'), 'C1M_RUNTIME': str(directory),
                   'C1M_TAG': tag, 'C1M_PHASE': 'first', **({'C4_BACKGROUND': '1'} if background_mode else {}), **({'C4_IMAGE': '1'} if image_mode else {}), **({'C4_STOP': '1'} if stop_mode else {})}
            owners.append({'root': directory, 'env': env, 'tag': tag, 'process': None, 'master': None, 'slave': None, 'terminal': b''})

        def drain():
            for owner in owners:
                master = owner['master']
                if master is not None and select.select([master], [], [], 0)[0]:
                    try:
                        owner['terminal'] = (owner['terminal'] + os.read(master, 65536))[-131072:]
                    except OSError as error:
                        if error.errno != errno.EIO:
                            raise

        def browser(mode, cookie=None, trigger=None):
            target = owners[0]['root'] if mode == 'capture' else root
            marker = root / 'browser-ready'
            marker.unlink(missing_ok=True)
            env = {**owners[0]['env'], **({'C2_TEST_COOKIE': cookie} if cookie else {})}
            script = 'tests/input-browser.mjs' if mode.startswith('input-') else 'tests/real-browser.mjs'
            mode = mode.removeprefix('input-')
            child = subprocess.Popen([node, str(REPO / script), mode, str(target)], cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            env.pop('C2_TEST_COOKIE', None)
            try:
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    drain()  # Drain both real PTYs during browser work; no terminal backpressure on reload.
                    if trigger and marker.exists():
                        trigger()
                        trigger = None
                    try:
                        output, errors = child.communicate(timeout=0.05)
                        if child.returncode or len(output) > 65536 or len(errors) > 65536:
                            raise RuntimeError('Controlled browser fixture failed')
                        return json.loads(output)
                    except subprocess.TimeoutExpired:
                        pass
                raise TimeoutError('Controlled browser wait')
            finally:
                owned = release(child, None, None, None, 0o077)
                if owned['cleanupErrors']:
                    raise RuntimeError('Controlled browser cleanup failed')

        if background_mode:
            # Reuse the approved generated own image, not desktop or browser capture.
            fixture_spec = importlib.util.spec_from_file_location('native_fixture', REPO / 'probes/run-native-media.py')
            fixture_module = importlib.util.module_from_spec(fixture_spec)
            fixture_spec.loader.exec_module(fixture_module)
            fixture = fixture_module.fixture_png()
            for owner in owners:
                (owner['root'] / 'cwd/fixture.png').write_bytes(fixture)
            agent_dir = owners[0]['root'] / 'agent/agents'
            agent_dir.mkdir(mode=0o700)
            (agent_dir / 'c4-disposable.md').write_text('---\nname: c4-disposable\ndescription: Isolated survival fixture\ntools: read\nmodel: c1m-disposable-script/fixed\nthinking: off\nasync: true\nextensions: ' + str(owners[0]['root'] / 'probe.ts') + '\ninheritProjectContext: false\ninheritGlobalContext: false\ninheritSkills: false\n---\nRead only the controlled fixture and finish with the fixed local response.\n')
        else:
            stage = 'controlled screenshot'
            screenshot = browser('capture')
            fixture = (owners[0]['root'] / 'cwd/fixture.png').read_bytes()
            assert screenshot['sha256'] == hashlib.sha256(fixture).hexdigest()
            if not input_mode: (owners[1]['root'] / 'cwd/fixture.png').write_bytes(fixture)  # Same-image collision is deliberate.

        def launch_owner(owner):
            master, slave = pty.openpty()
            owner.update({'master': master, 'slave': slave})
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))

            def own_terminal():
                os.setsid()
                fcntl.ioctl(0, termios.TIOCSCTTY, 0)

            owner['process'] = subprocess.Popen([executable, '--offline', '--no-approve', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--tools', 'read', '--provider', 'c1m-disposable-script', '--model', 'fixed', '--thinking', 'off', '--extension', str(owner['root'] / 'probe.ts'), '--extension', str(REPO / 'dist/extension/bridge.js'), *(['--extension', str(subagents / 'index.js')] if background_mode and owner is owners[0] else [])], cwd=owner['root'] / 'cwd', env=owner['env'], stdin=slave, stdout=slave, stderr=slave, preexec_fn=own_terminal)
            os.close(slave)
            owner['slave'] = None

        def evidence(owner, child=False):
            path = owner['root'] / ('child-evidence.json' if child else 'first-evidence.json')
            if not path.exists():
                return []
            assert path.stat().st_size <= 65536
            records = json.loads(path.read_text())
            assert not any(r['type'] in ('failure', 'stream_error') for r in records)
            return records

        def wait(owner, predicate, child=False):
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                drain()
                if predicate(evidence(owner, child)):
                    return
                if owner['process'].poll() is not None:
                    raise RuntimeError('Pi owner exited before evidence')
                time.sleep(0.05)
            raise TimeoutError('Real terminal wait')

        def send(owner, text):
            os.write(owner['master'], (text + '\r').encode())

        def read(owner):
            wait(owner, lambda records: any(r['type'] == 'ready' for r in records))
            send(owner, owner['tag'] + ':terminal-before')
            wait(owner, lambda records: any(r.get('label') == 'terminal-before' for r in records))
            send(owner, '/c1m-read')
            wait(owner, lambda records: any(r['type'] == 'settled' for r in records))
            settled = next(r for r in evidence(owner) if r['type'] == 'settled')
            assert settled['branch']['sha256'] == screenshot['sha256'] and settled['requests'] == 2 and settled['toolCalls'] == 1
            (owner['root'] / 'settled-copy.json').write_text(json.dumps(settled))

        def launch_gateway():
            child = subprocess.Popen([node, str(REPO / 'dist/gateway/cli.js')], cwd=REPO, env=owners[0]['env'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            try:
                deadline, output = time.monotonic() + 15, b''
                while time.monotonic() < deadline:
                    drain()
                    if select.select([child.stdout], [], [], 0.05)[0]:
                        output += os.read(child.stdout.fileno(), 1024)
                        assert len(output) < 4096
                        if b'Pairing code (submit in browser): ' in output and b'\nExpires: ' in output:
                            code = output.decode().split('browser): ')[1].splitlines()[0]
                            output = b''
                            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                            request = urllib.request.Request('http://127.0.0.1:4394/api/pair', data=json.dumps({'code': code, 'remember': False}).encode(), headers={'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1:4394', 'X-C2-CSRF': 'pair'})
                            with opener.open(request) as auth:
                                cookie = auth.headers['Set-Cookie'].split(';')[0]
                            code = None
                            return child, cookie
                    if child.poll() is not None:
                        raise RuntimeError('Gateway exited')
                raise TimeoutError('Gateway ready')
            except BaseException:
                release(child, None, None, None, 0o077)
                raise

        if background_mode:
            owner = owners[0]

            def process_start(pid):
                current = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='], capture_output=True, text=True)
                return current.stdout.strip() if current.returncode == 0 and current.stdout.strip() else None

            def process_identity(pid, run_id):
                started = process_start(pid)
                assert started is not None and str(uuid.UUID(run_id)) == run_id
                args = shlex.split(subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True).strip())
                assert len(args) == 5 and Path(args[0]).resolve() == Path(node).resolve()
                assert args[1:4] == ['--import', (subagents / 'runner-peer-preload.mjs').as_uri(), str(subagents / 'src/runs/background/subagent-runner-bootstrap.js')]
                config = Path(args[4]).resolve()
                assert config.is_relative_to(owner['root'] / 'tmp') and config.name == 'async-cfg-' + run_id + '.json'
                assert int(subprocess.check_output(['ps', '-p', str(pid), '-o', 'uid='], text=True)) == os.getuid()
                assert os.getpgid(pid) == pid  # Installed detached runner, not an owner's process group.
                assert process_start(pid) == started
                return started

            def capture_runner(record):
                directory = Path(record['asyncDir']).resolve()
                run_id, pid = record['id'], record['pid']
                assert str(uuid.UUID(run_id)) == run_id and directory.name == run_id and directory.parent.name == 'async-subagent-runs' and directory.is_relative_to(owner['root'] / 'tmp')
                if pid in runners:
                    assert runners[pid]['directory'] == directory and runners[pid]['id'] == run_id
                    return
                # Keep the exact artifact directory even if live identity inspection races exit.
                owned = {'directory': directory, 'id': run_id, 'identity': None, 'instance': None}
                runners[pid] = owned
                path = directory / 'process-terminal.json'
                assert path.stat().st_size <= 65536
                proof = json.loads(path.read_text())
                assert proof['version'] == 1 and proof['runId'] == run_id
                owned['instance'] = proof['runnerProcessInstanceId']
                assert str(uuid.UUID(owned['instance'])) == owned['instance']
                if process_start(pid) is not None:
                    try:
                        owned['identity'] = process_identity(pid, run_id)
                    except (AssertionError, subprocess.CalledProcessError, ProcessLookupError):
                        if process_start(pid) is not None:
                            raise

            def terminal_proof(pid, owned):
                path = owned['directory'] / 'process-terminal.json'
                if not path.exists():
                    return None
                assert path.stat().st_size <= 65536
                proof = json.loads(path.read_text())
                assert proof['version'] == 1 and proof['runId'] == owned['id'] and proof['runnerProcessInstanceId'] == owned['instance']
                if proof['state'] != 'observed':
                    return None
                instances = proof['instances']
                assert len(instances) == 1 and instances[0]['kind'] == 'runner' and instances[0]['processInstanceId'] == owned['instance']
                # Exit proof and exact PID/start inspection are both required. Never signal a reused PID.
                current = process_start(pid)
                if current is not None and (owned['identity'] is None or current == owned['identity']):
                    return None
                return proof

            def own_runners():
                for record in evidence(owner):
                    if record['type'] == 'subagent:async-started' and record.get('mode') == 'single':
                        capture_runner(record)

            def status(phase, completed=False):
                own_runners()
                assert len(runners) == 1
                pid, runner = next(iter(runners.items()))
                data = json.loads((runner['directory'] / 'status.json').read_text())
                child = evidence(owner, True)
                assert data['runId'] == runner['id'] and len(data['steps']) == 1
                assert data['state'] == ('complete' if completed else 'running')
                step = data['steps'][0]
                assert step['requestedModel'] == 'c1m-disposable-script/fixed' and step['model'] == 'c1m-disposable-script/fixed:off'
                extensions = step['launchResolvedExtensions']
                assert extensions['disableAmbientExtensions'] and len(extensions['configured']) == 1
                if completed:
                    assert step['runtimeAcknowledgedExtensions']['ids'] == ['c4-fixed-provider']
                assert [r['number'] for r in child if r['type'] == 'scripted_request'] == [1, 2]
                assert len([r for r in child if r['type'] == 'tool_call']) == 1 and len([r for r in child if r['type'] == 'ready']) == 1
                assert [r['number'] for r in evidence(owner) if r['type'] == 'scripted_request'] == ([1] if completed else [])
                assert not any(r['type'] in ('scripted_request', 'native_input', 'tool_call') for r in evidence(owners[1]))
                if not completed:
                    assert process_identity(pid, runner['id']) == runner['identity']
                    assert any(r['type'] == 'held_response' for r in child) and not any(r['type'] == 'released_response' for r in child)
                before = len([r for r in evidence(owner) if r['type'] == 'package_status'])
                send(owner, '/c4-status ' + runner['id'])
                wait(owner, lambda records: len([r for r in records if r['type'] == 'package_status']) > before)
                public = [r for r in evidence(owner) if r['type'] == 'package_status'][-1]
                workflow_id = next(r['parentWorkflowRunId'] for r in evidence(owner) if r['type'] == 'subagent:async-started' and r.get('mode') == 'single')
                assert public['target'] == {'runId': runner['id'], 'state': data['state'], 'parentWorkflowRunId': workflow_id}
                assert any(r['id'] == workflow_id for r in public['snapshotRoots'])
                assert public['parentIdle'] and public['requests'] == (1 if completed else 0) and public['toolCalls'] == 0
                lifecycle.append({'phase': phase, 'runId': runner['id'], 'state': data['state'], 'childRequests': 2, 'childResponses': 2 if completed else 1, 'reads': 1, 'parentRequests': public['requests'], 'publicOwningStatus': True})
                return runner

            def terminal(owner, label):
                before = len([r for r in evidence(owner) if r.get('label') == label])
                send(owner, owner['tag'] + ':' + label)
                wait(owner, lambda records: len([r for r in records if r.get('label') == label]) > before)

            stage = 'installed normal TUI explicit package and provider'
            launch_owner(owner)
            wait(owner, lambda records: any(r['type'] == 'ready' for r in records))
            terminal(owner, 'terminal-before')
            stage = 'native /run --bg exactly one child and held second response'
            send(owner, '/run c4-disposable ' + owner['tag'] + ':native-read --bg')
            # Capture verified runner ownership even when child setup fails.
            wait(owner, lambda records: any(r['type'] == 'subagent:async-started' and r.get('mode') == 'single' for r in records))
            own_runners()
            wait(owner, lambda records: any(r['type'] == 'held_response' for r in records), child=True)
            runner = status('held-before-browser')
            terminal(owner, 'terminal-before')
            gateway, cookie = launch_gateway()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            def summaries():
                with opener.open(urllib.request.Request('http://127.0.0.1:4394/api/snapshot', headers={'Cookie': cookie})) as response:
                    return json.load(response)['sessions']
            initial = summaries()
            assert len(initial) == 1
            launch_owner(owners[1])
            wait(owners[1], lambda records: any(r['type'] == 'ready' for r in records))
            terminal(owners[1], 'terminal-before')
            deadline = time.monotonic() + 15
            while len(summaries()) != 2 and time.monotonic() < deadline:
                drain(); time.sleep(0.05)
            both = summaries()
            assert len(both) == 2
            identities = {'a': {k: initial[0][k] for k in ('instance', 'generation')}, 'b': {k: next(s for s in both if s['instance'] != initial[0]['instance'])[k] for k in ('instance', 'generation')}}
            (root / 'background-owners.json').write_text(json.dumps(identities))
            stage = 'actual browser A B A and selected disconnect while held'
            first = browser('background-switch', cookie)
            status('browser-switch-and-close')
            stage = 'actual production gateway CLI death and new pairing lock acquisition'
            lock = root / 'ipc/gateway.lock'
            inode, old_pid, old_cookie = lock.stat().st_ino, gateway.pid, cookie
            gateway.kill()  # Actual CLI crash: kernel must release the descriptor-held flock.
            gateway.wait(timeout=10)
            assert gateway.returncode == -signal.SIGKILL and lock.stat().st_ino == inode
            gateway = None
            status('gateway-process-dead')
            for o in owners:
                terminal(o, 'terminal-after')
            gateway, cookie = launch_gateway()
            assert gateway.pid != old_pid and cookie != old_cookie and lock.stat().st_ino == inode
            recovered = browser('background-recover', cookie)
            status('new-cli-new-pairing-recovered-same-owner')
            stage = 'release genuine child provider only after recovery same ID completion'
            (owner['root'] / 'release-child').write_text('release')
            wait(owner, lambda records: any(r['type'] == 'settled' for r in records), child=True)
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                drain()
                data = json.loads((runner['directory'] / 'status.json').read_text())
                if data['state'] == 'complete' and terminal_proof(next(iter(runners)), runner):
                    break
                time.sleep(0.05)
            else:
                raise TimeoutError('Same child terminal status/process proof')
            wait(owner, lambda records: any(r['type'] == 'parent_acknowledgement_settled' for r in records))
            status('same-child-complete-parent-acknowledged', completed=True)
            proof = terminal_proof(next(iter(runners)), runner)
            assert proof and proof['instances'][0]['exitCode'] == 0 and proof['instances'][0]['signal'] is None
            events_path = runner['directory'] / 'events.jsonl'
            assert events_path.stat().st_size < 262144
            events = [json.loads(line) for line in events_path.read_text().splitlines()]
            assert sum(e['type'] == 'subagent.run.started' for e in events) == 1
            assert sum(e['type'] == 'subagent.run.completed' for e in events) == 1
            assert sum(e['type'] == 'tool_execution_start' for e in events) == 1
            settled = next(r for r in evidence(owner, True) if r['type'] == 'settled')
            assert settled['requests'] == settled['responses'] == 2 and settled['toolCalls'] == settled['inputs'] == 1
            assert settled['branch']['sha256'] == hashlib.sha256(fixture).hexdigest()
            assert len([r for r in evidence(owner) if r['type'] == 'subagent:async-started' and r.get('mode') == 'single']) == 1
            for o in owners:
                terminal(o, 'terminal-after')
                assert o['process'].poll() is None
            gateway.send_signal(signal.SIGTERM); gateway.wait(timeout=10)
            assert gateway.returncode == 0
            gateway = None
            for o in owners:
                terminal(o, 'terminal-after')
                send(o, '/c1m-finish')
                wait(o, lambda records: any(r['type'] == 'shutdown' for r in records))
                o['process'].wait(timeout=5)
                assert o['process'].returncode == 0
            assert not list((root / 'ipc').glob('b-*'))
            result = {'verdict': 'completed', 'slice': 'C4-E', 'piVersion': '0.99.2', 'subagentsVersion': '0.73.1', 'entryPoint': '/run c4-disposable <owned-tag>:native-read --bg', 'realTerminalOwners': 2,
                      'nativeChildren': 1, 'scriptedResponses': 3, 'childResponses': 2, 'nativeReads': 1, 'parentRequestsBeforeCompletion': 0, 'parentAcknowledgementResponses': 1, 'parentReads': 0, 'idleOwnerRequestsAndReads': 0,
                      'lifecycle': lifecycle, 'browserEvidence': [first, recovered], 'gatewayCliKilledExit': -signal.SIGKILL,
                      'newCliPidAndTemporaryCookie': True, 'flockInodePreservedAndReacquired': True,
                      'processTerminalObserved': True, 'terminalBeforeHeldAfterRecoveryAndCompletion': True,
                      'childBranch': settled['branch'], 'piExits': [0, 0], 'ownerOnlyRuntime': True}
            for path in [root, *root.rglob('*')]:
                if not path.is_symlink():
                    assert path.stat().st_mode & 0o777 == (0o700 if path.is_dir() else 0o600)
            code = 0
        elif input_mode:
            stage = 'real browser public native input'
            owner = owners[0]
            launch_owner(owner)
            wait(owner, lambda records: any(r['type'] == 'ready' for r in records))
            send(owner, owner['tag'] + ':terminal-before')
            wait(owner, lambda records: any(r.get('label') == 'terminal-before' for r in records))
            gateway, cookie = launch_gateway()
            first = browser('input-send', cookie)
            settled = next(r for r in evidence(owner) if r['type'] == 'settled')
            assert settled['branch']['sha256'] == screenshot['sha256'] and settled['branch']['userCount'] == 1
            assert (owner['tag'] + ':native-read').encode() in owner['terminal'] and (b'C4 held response.' if stop_mode else b'C4 fixed final response.') in owner['terminal'] and b'fixture.png' in owner['terminal']  # Owning TUI rendered the native turn/tool, not only the before tag.
            gateway.send_signal(signal.SIGTERM)
            gateway.wait(timeout=10)
            assert gateway.returncode == 0 and owner['process'].poll() is None
            gateway = None
            send(owner, owner['tag'] + ':terminal-after')
            wait(owner, lambda records: any(r.get('label') == 'terminal-after' for r in records))
            stage = 'gateway restart deliberate pairing claim native dedup'
            gateway, cookie = launch_gateway()
            recovered = browser('input-recover', cookie)
            gateway.send_signal(signal.SIGTERM)
            gateway.wait(timeout=10)
            assert gateway.returncode == 0 and owner['process'].poll() is None
            gateway = None
            before = len([r for r in evidence(owner) if r.get('label') == 'terminal-after'])
            send(owner, owner['tag'] + ':terminal-after')
            wait(owner, lambda records: len([r for r in records if r.get('label') == 'terminal-after']) > before)
            send(owner, '/c1m-finish')
            wait(owner, lambda records: any(r['type'] == 'shutdown' for r in records))
            owner['process'].wait(timeout=5)
            assert owner['process'].returncode == 0 and not list((root / 'ipc').glob('b-*'))
            for path in [root, *root.rglob('*')]:
                if not path.is_symlink():
                    assert path.stat().st_mode & 0o777 == (0o700 if path.is_dir() else 0o600)
            if image_mode:
                image_settings = json.loads((owner['root'] / 'agent/settings.json').read_text()).get('images')
                assert image_settings == {'autoResize': False}  # No explicit block setting masks Pi's omitted default.
            result = {'verdict': 'completed', 'slice': 'C4-C2' if stop_mode else 'C4-B' if image_mode else 'C4-A', 'piVersion': '0.99.2', 'realTerminalOwners': 1,
                      **({'imageSettings': image_settings, 'blockImagesSettingOmitted': True} if image_mode else {}),
                      'scriptedResponses': 2, 'nativeReads': 1, 'nativeUserEntries': 1,
                      'screenshot': screenshot, 'browserEvidence': [first, recovered],
                      'owningTuiTaggedNativeTextObserved': True, 'gatewayLossTerminalStillUsable': True,
                      'noAutomaticPairClaimRestartSend': True,
                      **({'genuineHeldResponseAbort': True, 'publicParentSettledIdleNoPending': True, 'noDepartureAbort': True} if stop_mode else {}),
                      'piExits': [0], 'ownerOnlyRuntime': True}
            code = 0
        else:
            stage = 'owner A before gateway native read'
            launch_owner(owners[0])
            read(owners[0])
            gateway, cookie = launch_gateway()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(urllib.request.Request('http://127.0.0.1:4394/api/snapshot', headers={'Cookie': cookie})) as response:
                initial = json.load(response)
            assert len(initial['sessions']) == 1 and 'snapshot' not in initial
            stage = 'owner B after gateway native read'
            launch_owner(owners[1])
            read(owners[1])
            stage = 'two native browsers selection inline enlarged independent tabs'
            first = browser('assert', cookie)
            assert len(first) == 4 and all(item['noDuplicates'] for item in first)
            gateway.send_signal(signal.SIGTERM)
            gateway.wait(timeout=10)
            assert gateway.returncode == 0 and all(owner['process'].poll() is None for owner in owners)
            gateway = None
            for owner in owners:
                send(owner, owner['tag'] + ':terminal-after')
                wait(owner, lambda records: any(r.get('label') == 'terminal-after' for r in records))
            stage = 'gateway restart both native recovery'
            gateway, cookie = launch_gateway()
            recovered = browser('assert', cookie)
            assert first == recovered
            stage = 'actual native reload selected A while B unaffected'
            reload_evidence = browser('reload', cookie, lambda: send(owners[0], '/reload'))
            assert reload_evidence[0]['instance'] == first[0]['instance'] and reload_evidence[0]['generation'] != first[0]['generation']
            after_reload = browser('assert', cookie)
            assert all(a['instance'] == b['instance'] and a['sha256'] == b['sha256'] and a['entry'] == b['entry'] and (a['generation'] != b['generation'] if a['owner'] == 'a' else a['generation'] == b['generation']) for a, b in zip(first, after_reload))
            for owner in owners:
                before = len([r for r in evidence(owner) if r.get('label') == 'terminal-after'])
                send(owner, owner['tag'] + ':terminal-after')
                wait(owner, lambda records: len([r for r in records if r.get('label') == 'terminal-after']) > before)
            stage = 'selected B native shutdown keeps A live and cached B disconnected'
            disconnected = browser('disconnect', cookie, lambda: send(owners[1], '/c1m-finish'))
            owners[1]['process'].wait(timeout=5)
            assert owners[1]['process'].returncode == 0 and owners[0]['process'].poll() is None
            gateway.send_signal(signal.SIGTERM)
            gateway.wait(timeout=10)
            assert gateway.returncode == 0
            gateway = None
            stage = 'owner A terminal survives browser/gateway/B shutdown'
            before = len([r for r in evidence(owners[0]) if r.get('label') == 'terminal-after'])
            send(owners[0], owners[0]['tag'] + ':terminal-after')
            wait(owners[0], lambda records: len([r for r in records if r.get('label') == 'terminal-after']) > before)
            send(owners[0], '/c1m-finish')
            wait(owners[0], lambda records: any(r['type'] == 'shutdown' for r in records))
            owners[0]['process'].wait(timeout=5)
            assert owners[0]['process'].returncode == 0 and not list((root / 'ipc').glob('b-*'))
            for path in [root, *root.rglob('*')]:
                if not path.is_symlink():
                    assert path.stat().st_mode & 0o777 == (0o700 if path.is_dir() else 0o600)
            result = {'verdict': 'completed', 'piVersion': '0.99.2', 'realTerminalOwners': 2, 'scriptedResponses': 4, 'nativeReads': 2,
                      'screenshot': screenshot, 'sameImageCollisionIsolated': True, 'bridgeBeforeAndAfterGateway': True,
                      'browserEvidence': [{k: v for k, v in item.items() if k not in ('instance', 'generation', 'ref', 'entry')} for item in first],
                      'independentSameCookieTabs': True, 'gatewayRestartBothNativeItemsBytesNoDuplicates': True,
                      'actualNativeReloadStaleMediaRejectedOtherOwnerUnchanged': True, 'selectedOwnerShutdown': disconnected,
                      'browserGatewayDisconnectBothTerminalsStillWork': True, 'piExits': [owner['process'].returncode for owner in owners], 'ownerOnlyRuntime': True}
            code = 0
    except KeyboardInterrupt:
        result, code = {'verdict': 'blocked', 'stage': stage, 'errorType': 'KeyboardInterrupt'}, 130
    except Exception as error:
        result = {'verdict': 'blocked', 'stage': stage, 'errorType': type(error).__name__}
        if background_mode:
            result['assertionLine'] = traceback.extract_tb(error.__traceback__)[-1].lineno
            result['error'] = str(error)[:256] if isinstance(error, (AssertionError, TimeoutError, RuntimeError)) else 'See stage and own fixture evidence'
    finally:
        runner_errors = []
        if background_mode and owners:
            # Preserve only bounded own-fixture records before deleting temporary resources.
            captured = {}
            for o in owners:
                for child in (False, True):
                    path = o['root'] / ('child-evidence.json' if child else 'first-evidence.json')
                    if path.exists() and path.stat().st_size <= 65536:
                        records = json.loads(path.read_text())
                        captured[o['root'].name + ('-child' if child else '-parent')] = [{k: v for k, v in r.items() if k not in ('asyncDir', 'pid')} for r in records]
                        for r in records:
                            if r['type'] == 'subagent:async-started' and r.get('mode') == 'single' and r['pid'] not in runners:
                                try:
                                    capture_runner(r)
                                except Exception as error:
                                    # An already-captured directory/instance can still prove exit below.
                                    if r['pid'] not in runners:
                                        runner_errors.append('runner-capture:' + type(error).__name__)
            if result is not None:
                result['fixtureEvidence'] = captured
                result['lifecycle'] = lifecycle
            artifacts, cleanup_proofs = [], []
            for pid, owned in runners.items():
                try:
                    proof = terminal_proof(pid, owned)
                    current = process_start(pid)
                    package_stop = False
                    if not proof and current is not None and current == owned['identity'] and not (owner['root'] / 'release-child').exists():
                        # Native targeted stop lets the child dispose and publish writer-terminal proof.
                        # Never replace an unresolved package stop with a destructive signal/fake completion.
                        assert code != 0 and owner['process'].poll() is None
                        assert process_identity(pid, owned['id']) == owned['identity']
                        parent_path = owner['root'] / 'first-evidence.json'
                        assert parent_path.stat().st_size <= 65536
                        parent_records = json.loads(parent_path.read_text())
                        starts = [r for r in parent_records if r['type'] == 'subagent:async-started']
                        workflows = [r for r in starts if r.get('mode') == 'workflow']
                        children = [r for r in starts if r.get('mode') == 'single']
                        assert len(starts) == 2 and len(workflows) == len(children) == 1 and children[0]['id'] == owned['id'] and children[0]['parentWorkflowRunId'] == workflows[0]['id']
                        workflow = workflows[0]
                        directory = Path(workflow['asyncDir']).resolve()
                        assert directory.is_relative_to(owner['root'] / 'tmp') and directory.name == workflow['id']
                        data = json.loads((owned['directory'] / 'status.json').read_text())
                        parent_data = json.loads((directory / 'status.json').read_text())
                        assert data['runId'] == owned['id'] and data['parentWorkflowRunId'] == workflow['id'] and data['state'] in ('running', 'queued')
                        assert parent_data['runId'] == workflow['id'] and parent_data['state'] == 'running' and workflow['pid'] == owner['process'].pid
                        assert not any(r['type'] == 'parent_acknowledgement' for r in parent_records)
                        (owner['root'] / 'cleanup-child').write_text('cleanup only')
                        send(owner, '/subagents-stop ' + workflow['id'])
                        package_stop = True
                    deadline = time.monotonic() + 15
                    while not proof and time.monotonic() < deadline:
                        drain(); time.sleep(0.05)
                        proof = terminal_proof(pid, owned)
                    if not proof:
                        raise RuntimeError('Owned runner termination proof unresolved')
                    if package_stop:
                        wait(owner, lambda records: any(r['type'] == 'cleanup_parent_acknowledgement_settled' for r in records))
                    cleanup_proofs.append({'runId': owned['id'], 'state': proof['state'], 'instanceMatched': True, 'exactCapturedProcessAbsent': True, 'packageStopForFailureOnly': package_stop, 'exitCode': proof['instances'][0]['exitCode'], 'signal': proof['instances'][0]['signal']})
                except Exception as error:
                    runner_errors.append('runner-cleanup:' + type(error).__name__)
                directory = owned.get('directory')
                if directory and (directory / 'status.json').exists():
                    path = directory / 'status.json'
                    if path.stat().st_size <= 65536:
                        data = json.loads(path.read_text())
                        projection = {k: data[k] for k in ('runId', 'mode', 'state', 'toolCount', 'turnCount', 'model') if k in data}
                        projection['steps'] = [{k: step[k] for k in ('status', 'model', 'requestedModel', 'toolCount', 'turnCount', 'launchResolvedExtensions', 'runtimeAcknowledgedExtensions') if k in step} for step in data.get('steps', [])]
                        errors = [data.get('error'), *[step.get('error') for step in data.get('steps', [])]]
                        projection['errors'] = [str(error).replace(str(root), '<fixture>').replace(str(subagents), '<installed-subagents>').replace(str(package), '<installed-pi>')[:512] for error in errors if error]
                        artifacts.append(projection)
            # Refresh sanitized evidence after native stop/acknowledgement; old failures remain untouched.
            for o in owners:
                for child in (False, True):
                    path = o['root'] / ('child-evidence.json' if child else 'first-evidence.json')
                    if path.exists() and path.stat().st_size <= 65536:
                        records = json.loads(path.read_text())
                        captured[o['root'].name + ('-child' if child else '-parent')] = [{k: v for k, v in r.items() if k not in ('asyncDir', 'pid')} for r in records]
            if result is not None:
                result['runnerCleanupProofs'] = cleanup_proofs
                result['packageArtifactEvidence'] = artifacts
                result['detachedRunnersGone'] = not runner_errors
                result['nativeChildHostedInsideRunner'] = True
        gateway_cleanup = release(gateway, None, None, None, 0o077)
        owner_cleanup = [release(owner['process'], owner['master'], owner['slave'], None, 0o077) for owner in owners]
        # An unverified live runner must retain its own files for safe manual cleanup,
        # never silently disappear from bookkeeping while the harness deletes its root.
        cleanup = release(None, None, None, None if runner_errors else root, old_umask)
        if runner_errors:
            cleanup['runtimeRemoved'] = False
            if result is not None:
                result['retainedOwnedRuntime'] = str(root)
        if result is not None:
            result.update(cleanup)
            result['gatewayReaped'] = gateway_cleanup['childReaped']
            result['childReaped'] = all(item['childReaped'] for item in owner_cleanup)
            result['ptyClosed'] = all(item['ptyClosed'] for item in owner_cleanup)
            result['cleanupErrors'] += runner_errors + gateway_cleanup['cleanupErrors'] + [error for item in owner_cleanup for error in item['cleanupErrors']]
            if result['cleanupErrors'] or not all(result[k] for k in ('gatewayReaped', 'childReaped', 'ptyClosed', 'runtimeRemoved', 'umaskRestored')):
                code = 1
    print(json.dumps(result, indent=2))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
