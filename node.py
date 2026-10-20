#!/usr/bin/env python3
"""LXD node agent for LVM Panel remote compute nodes."""
import asyncio
import os
import platform
import shutil
import time
import logging
from datetime import datetime
from flask import Flask, jsonify, request
from lxd_backend import LXDRuntime

app = Flask(__name__)
logger = logging.getLogger(__name__)
API_KEY = os.getenv('NRB_NODE_API_KEY', '')
PORT = int(os.getenv('PORT', '9000'))
BIND_HOST = os.getenv('NODE_BIND_HOST', '127.0.0.1')
STARTED_AT = time.time()


def auth_error():
    if not API_KEY or request.headers.get('X-API-Key') != API_KEY:
        return jsonify(success=False, error='Unauthorized; configure NRB_NODE_API_KEY on the node agent'), 401
    return None


@app.get('/api/ping')
def ping():
    error = auth_error()
    if error:
        return error
    return jsonify(status='ok', time=datetime.now().isoformat(), runtime='LXD')


@app.get('/api/host/stats')
def host_stats():
    error = auth_error()
    if error:
        return error
    try:
        import psutil
        ram = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        return jsonify(
            cpu=psutil.cpu_percent(interval=0.15),
            cpu_cores=psutil.cpu_count() or 0,
            ram={'total': round(ram.total / 1024**2), 'used': round(ram.used / 1024**2), 'free': round(ram.available / 1024**2), 'percent': ram.percent},
            disk={'total': round(disk.total / 1024**3, 2), 'used': round(disk.used / 1024**3, 2), 'free': round(disk.free / 1024**3, 2), 'total_gb': round(disk.total / 1024**3, 2), 'percent': disk.percent},
            uptime=f'{int(time.time() - STARTED_AT)} seconds'
        )
    except Exception:
        logger.exception('Node operation failed')
        return jsonify(error='Node operation failed'), 500


@app.get('/api/info')
def info():
    error = auth_error()
    if error:
        return error
    try:
        version = LXDRuntime._run_sync(['lxc', 'version'], timeout=10)
        LXDRuntime._run_sync(['lxc', 'info'], timeout=10)
        return jsonify(success=True, version='LVM LXD Node 1.0', python_version=platform.python_version(), runtime='LXD', lxd_version=version)
    except Exception:
        logger.exception('Node information request failed')
        return jsonify(success=False, error='Node information unavailable', runtime='LXD'), 503


@app.post('/api/execute')
def execute():
    error = auth_error()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    command = str(data.get('command', '')).strip()
    container = str(data.get('container', '')).strip()
    timeout = min(max(int(data.get('timeout', 120)), 1), 900)
    if not command:
        return jsonify(success=False, error='Command is required'), 400
    try:
        result = asyncio.run(LXDRuntime.run(container, command, timeout=timeout))
        return jsonify(success=True, stdout=result if isinstance(result, str) else '', result=result)
    except Exception:
        logger.exception('Node LXD operation failed')
        return jsonify(success=False, error='LXD operation failed'), 500


@app.post('/api/container/stats')
def container_stats():
    error = auth_error()
    if error:
        return error
    name = str((request.get_json(silent=True) or {}).get('container', '')).strip()
    if not name:
        return jsonify(error='Instance name is required'), 400
    try:
        info = asyncio.run(LXDRuntime.run(name, f'info {name}', timeout=15))
        status_line = next((line.split(':', 1)[1].strip().lower() for line in str(info).splitlines() if line.startswith('Status:')), 'unknown')
        if status_line != 'running':
            return jsonify(status=status_line, cpu=0, ram={'used': 0, 'total': 0, 'percent': 0}, disk='Stopped', uptime='Unknown', processes=0, network={})
        memory = asyncio.run(LXDRuntime.run(name, f'exec {name} -- free -m', timeout=10))
        disk = asyncio.run(LXDRuntime.run(name, f'exec {name} -- df -hP /', timeout=10))
        uptime = asyncio.run(LXDRuntime.run(name, f'exec {name} -- uptime -p', timeout=10))
        processes = asyncio.run(LXDRuntime.run(name, f'exec {name} -- sh -lc "ps -e --no-headers 2>/dev/null | wc -l"', timeout=10))
        mem_values = next((line.split() for line in str(memory).splitlines() if line.strip().lower().startswith('mem:')), [])
        mem_total = int(mem_values[1]) if len(mem_values) > 2 else 0
        mem_used = int(mem_values[2]) if len(mem_values) > 2 else 0
        disk_lines = str(disk).splitlines()
        disk_values = disk_lines[-1].split() if len(disk_lines) > 1 else []
        disk_value = f'{disk_values[2]}/{disk_values[1]} ({disk_values[4]})' if len(disk_values) > 4 else 'Unknown'
        return jsonify(status=status_line, cpu=0, ram={'used': mem_used, 'total': mem_total, 'percent': (mem_used / mem_total * 100) if mem_total else 0}, disk=disk_value, uptime=str(uptime).strip(), processes=int(str(processes).strip() or 0), network={})
    except Exception:
        logger.exception('Node operation failed')
        return jsonify(error='Node operation failed'), 500


@app.get('/api/status')
def status():
    error = auth_error()
    if error:
        return error
    try:
        version = LXDRuntime._run_sync(['lxc', 'version'], timeout=10)
        LXDRuntime._run_sync(['lxc', 'info'], timeout=10)
        return jsonify(success=True, runtime='LXD', version=version)
    except Exception:
        logger.exception('Node status request failed')
        return jsonify(success=False, runtime='LXD', error='Node status unavailable'), 503


@app.post('/api/container/<action>')
def container_action(action):
    error = auth_error()
    if error:
        return error
    actions = {'start': 'start', 'stop': 'stop', 'restart': 'restart', 'pause': 'freeze', 'unpause': 'unfreeze'}
    if action not in actions:
        return jsonify(success=False, error='Invalid action'), 400
    name = str((request.get_json(silent=True) or {}).get('container', '')).strip()
    if not name:
        return jsonify(success=False, error='Instance name is required'), 400
    try:
        result = asyncio.run(LXDRuntime.run(name, f'{actions[action]} {name}', timeout=120))
        return jsonify(success=True, result=result)
    except Exception:
        logger.exception('Node LXD operation failed')
        return jsonify(success=False, error='LXD operation failed'), 500


if __name__ == '__main__':
    app.run(host=BIND_HOST, port=PORT)
