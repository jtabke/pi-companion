#!/usr/bin/env python3
"""Opt-in Pi native command probe: isolated PTY and production bridge, no inference."""
from concurrent.futures import ThreadPoolExecutor
import errno
import fcntl
import http.client
import importlib.util
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import socket
import struct
import subprocess
import tempfile
import termios
import time

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('owned_cleanup', REPO / 'probes/run-c1.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('localhost', timeout=3)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(self.path))


def main():
    executable, node = shutil.which('pi'), shutil.which('node')
    if not executable or not node:
        raise SystemExit('Existing Pi and Node required')
    setup_spec = importlib.util.spec_from_file_location('declaration_setup', REPO / 'scripts/link-pi-declarations.py')
    setup = importlib.util.module_from_spec(setup_spec)
    setup_spec.loader.exec_module(setup)
    package = setup.installed_package(executable)
    meta = json.loads((package / 'package.json').read_text())
    if meta['name'] != '@earendil-works/pi-coding-agent' or meta['version'] not in {'1.0.1', '1.0.2'}:
        raise SystemExit('Probe reviewed only for Pi 1.0.1 and 1.0.2')
    entry = REPO / json.loads((REPO / 'package.json').read_text())['pi']['extensions'][0]
    if not entry.is_file():
        raise SystemExit('Companion package extension entry required')
    old_umask = os.umask(0o077)
    root = process = master = slave = None
    stage, code = 'setup', 1
    result = {'piVersion': meta['version'], 'checks': []}
    try:
        root = Path(tempfile.mkdtemp(prefix='pi-nc-', dir='/tmp')).resolve()
        for leaf in ['home', 'agent', 'config', 'sessions', 'cwd', 'tmp', 'ipc', 'node_modules/@earendil-works']:
            (root / leaf).mkdir(mode=0o700, parents=True, exist_ok=True)
        (root / 'node_modules/@earendil-works/pi-coding-agent').symlink_to(package, target_is_directory=True)
        shutil.copy(REPO / 'probes/native-command-extension.ts', root / 'probe.ts')
        (root / 'agent/settings.json').write_text(json.dumps({'retry': {'enabled': False}, 'compaction': {'enabled': False}, 'cacheWarming': 'off', 'enableAnalytics': False, 'enableInstallTelemetry': False}))
        env = {'PATH': os.defpath + os.pathsep + str(Path(executable).parent) + os.pathsep + str(Path(node).parent),
               'HOME': str(root/'home'), 'XDG_CONFIG_HOME': str(root/'config'), 'TMPDIR': str(root/'tmp'),
               'PI_CODING_AGENT_DIR': str(root/'agent'), 'PI_CODING_AGENT_SESSION_DIR': str(root/'sessions'),
               'TERM': 'xterm-256color', 'LANG': 'en_US.UTF-8', 'PI_OFFLINE': '1', 'PI_SKIP_VERSION_CHECK': '1',
               'PI_TELEMETRY': '0', 'PI_IMAGE_PROTOCOL': 'none', 'COMMAND_PROBE_ROOT': str(root), 'C2_RUNTIME': str(root/'ipc')}
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))

        def own_terminal():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        process = subprocess.Popen([executable, '--offline', '--no-approve', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-tools', '--provider', 'command-fixture', '--model', 'first', '--thinking', 'off', '--extension', str(entry), '--extension', str(root/'probe.ts')], cwd=root/'cwd', env=env, stdin=slave, stdout=slave, stderr=slave, preexec_fn=own_terminal)
        os.close(slave)
        slave = None

        def records():
            path = root/'events.jsonl'
            return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

        def drain():
            if select.select([master], [], [], 0.03)[0]:
                try:
                    os.read(master, 65536)  # Drain without retaining private/raw terminal output.
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise

        def wait(predicate):
            deadline = time.monotonic()+20
            while time.monotonic() < deadline:
                drain()
                if predicate():
                    return
                if process.poll() is not None:
                    raise RuntimeError('Owned Pi exited')
            raise TimeoutError('Native probe wait')

        def registration():
            files = list((root/'ipc').glob('b-*.json'))
            if len(files) != 1:
                return None
            return json.loads(files[0].read_text())

        def ipc(reg, path, body=None):
            def exchange():
                connection = UnixHTTP(root/'ipc'/('b-'+reg['generation']+'.sock'))
                try:
                    connection.request('POST' if body else 'GET', path, json.dumps(body) if body else None,
                                       {'x-c2-capability': reg['capability'], 'content-type': 'application/json'})
                    response = connection.getresponse()
                    assert response.status == 200
                    data = response.read(900001)
                    assert len(data) <= 900000
                    return json.loads(data)
                finally:
                    connection.close()
            # Pi's TUI can block on PTY backpressure. Keep draining during bounded IPC reads.
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(exchange)
                while not future.done():
                    drain()
                return future.result()

        sequence = 0

        def body(reg, text):
            nonlocal sequence
            sequence += 1
            return {'instance': reg['instance'], 'generation': reg['generation'], 'requestId': format(sequence, '032x'), 'text': text}

        def terminal_check(label):
            os.write(master, ('\x15/command-probe-check '+label+'\r').encode())
            wait(lambda: any(r['type']=='terminal_command' and r['args']==label for r in records()))
            return next(r for r in records() if r['type']=='terminal_command' and r['args']==label)

        stage = 'startup'
        wait(lambda: registration() is not None)
        reg = registration()
        initial = ipc(reg, '/snapshot')
        assert 'generationReason' not in initial
        assert [c['name'] for c in initial['commands'] if c['source']=='builtin'] == ['new', 'reload', 'model']
        assert initial['commandModels'] == [{'reference': 'command-fixture/first', 'name': 'Fixture first'}, {'reference': 'command-fixture/second', 'name': 'Fixture second'}]
        assert any('Previous conversation fixture' in block.get('text', '') for item in initial['items'] for block in item['blocks'])
        stage = 'terminal draft guard'
        rejected = body(reg, '/new')
        assert ipc(reg, '/text', rejected)['reason'] == 'terminal-draft'
        terminal_check('before')  # Clears the fixture draft through its real editor.
        assert ipc(reg, '/text', rejected)['reason'] == 'terminal-draft'
        result['checks'].append('Terminal draft rejection stays immutable for its request ID')
        stage = 'terminal reload activation'
        before_activation = ipc(reg, '/status')['canonicalSession']
        os.write(master, b'/reload \r')  # Exact terminal command; do not clear or replace a draft.
        wait(lambda: registration() is not None and registration()['generation'] != reg['generation'])
        activated = registration()
        assert activated['instance'] == reg['instance']
        assert ipc(activated, '/status')['canonicalSession'] == before_activation
        assert ipc(activated, '/snapshot')['generationReason'] == 'reload'
        assert [c['name'] for c in ipc(activated, '/snapshot')['commands'] if c['source'] == 'builtin'] == ['new', 'reload', 'model']
        reg = activated
        result['checks'].append('Exact terminal /reload activates the command hook without replacing Pi or its session')
        stage = 'command admission'
        for text in ['/unknown', '/new extra', '/model', '/model command-fixture/missing', '/model command-fixture/second extra', '/command-probe-check external']:
            assert ipc(reg, '/text', body(reg, text))['reason'] == 'slash-unsupported'
        result['checks'].append('Unknown, malformed, bare model and unverified extension commands never reach model input')
        stage = 'model dispatch'
        model_request = body(reg, '/model command-fixture/second')
        assert ipc(reg, '/text', model_request)['status'] == 'dispatched'
        assert ipc(reg, '/text', model_request)['status'] == 'dispatched'
        wait(lambda: ipc(reg, '/snapshot')['model']=='command-fixture/second')
        assert terminal_check('model')['model']=='second'
        result['checks'].append('Exact native model command executes through production bridge; same-ID repeat is not a new submission')
        stage = 'new conversation'
        assert ipc(reg, '/text', body(reg, '/new'))['status'] == 'dispatched'
        wait(lambda: registration() is not None and registration()['generation'] != reg['generation'])
        fresh = registration()
        assert fresh['instance']==reg['instance']
        wait(lambda: any(r['type']=='ready' and r['reason']=='new' for r in records()))
        before = next(r for r in records() if r['type']=='ready' and r['reason']=='startup')
        new = next(r for r in records() if r['type']=='ready' and r['reason']=='new')
        assert new['session']!=before['session']
        fresh_snapshot = ipc(fresh, '/snapshot')
        assert fresh_snapshot['items']==[] and 'generationReason' not in fresh_snapshot
        assert ipc(fresh, '/text', body(reg, '/new'))['reason']=='stale'
        assert terminal_check('new')['seedPresent'] is False
        result['checks'].append('Native /new clears conversation, rotates generation, preserves terminal instance and rejects stale identity')
        stage = 'reload'
        assert ipc(fresh, '/text', body(fresh, '/reload'))['status']=='dispatched'
        wait(lambda: registration() is not None and registration()['generation'] != fresh['generation'])
        reloaded = registration()
        assert reloaded['instance']==fresh['instance']
        assert ipc(reloaded, '/snapshot')['generationReason']=='reload'
        wait(lambda: any(r['type']=='ready' and r['reason']=='reload' and r['session']==new['session'] for r in records()))
        reload_record = next(r for r in records() if r['type']=='ready' and r['reason']=='reload' and r['session']==new['session'])
        assert reload_record['session']==new['session'] and reload_record['generation']!=new['generation']
        assert ipc(reloaded, '/text', body(fresh, '/reload'))['reason']=='stale'
        assert ipc(reloaded, '/text', body(reloaded, '/model command-fixture/second'))['status']=='dispatched'
        wait(lambda: ipc(reloaded, '/snapshot')['model']=='command-fixture/second')
        terminal_check('after')
        rs = records()
        assert not any(r['type'] in ['unexpected_input', 'provider_attempt', 'before_agent_start', 'agent_start'] for r in rs)
        assert len({r['pid'] for r in rs})==1 and any(r['type']=='terminal_editor_input' for r in rs)
        result['checks'].append('Native /reload reports its observed lifecycle reason, retains session, recreates bridge, rejects stale identity and restores browser/terminal command execution')
        stage = 'shutdown'
        os.write(master, b'/quit\r')
        wait(lambda: any(r['type']=='shutdown' and r['reason']=='quit' for r in records()))
        process.wait(timeout=5)
        assert process.returncode==0
        result.update(verdict='passed', providerAttempts=0, agentStarts=0, piProcesses=1)
        code = 0
    except KeyboardInterrupt:
        result.update(verdict='interrupted', stage=stage)
        code = 130
    except Exception as error:
        result.update(verdict='failed', stage=stage, errorType=type(error).__name__)
    finally:
        previous = signal.signal(signal.SIGINT, signal.SIG_IGN)
        try:
            result['cleanup'] = module.cleanup_runtime(process, master, slave, root, old_umask)
        finally:
            signal.signal(signal.SIGINT, previous)
        if result['cleanup']['cleanupErrors'] or not all(result['cleanup'][key] for key in ['childReaped', 'ptyClosed', 'runtimeRemoved', 'umaskRestored']):
            code = 1
    print(json.dumps(result, indent=2))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
