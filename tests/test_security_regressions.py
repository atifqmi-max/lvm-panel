from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_api_keys_are_not_accepted_from_query_strings():
    for filename in ("nrb.py", "api.py"):
        source = (ROOT / filename).read_text(encoding="utf-8")
        assert "request.args.get('api_key')" not in source
        assert "request.args.get(\"api_key\")" not in source


def test_ssh_does_not_use_shared_root_password_or_auto_trust_host_keys():
    source = (ROOT / "nrb.py").read_text(encoding="utf-8")
    assert "'root:root'" not in source
    assert 'password="root"' not in source
    assert "password='root'" not in source
    assert "paramiko.AutoAddPolicy()" not in source
    assert "paramiko.RejectPolicy()" in source
    assert "ssh_password_encrypted" in source


def test_legacy_node_api_never_executes_commands_on_panel_host():
    source = (ROOT / "nrb.py").read_text(encoding="utf-8")
    start = source.index("@app.route('/api/execute', methods=['POST'])")
    end = source.index("@app.route('/api/get_host_stats', methods=['GET'])", start)
    route = source[start:end]
    assert "subprocess.run(" not in route
    assert "execute_container(container, command" in route


def test_remote_node_agent_defaults_to_loopback():
    source = (ROOT / "node.py").read_text(encoding="utf-8")
    assert "BIND_HOST = os.getenv('NODE_BIND_HOST', '127.0.0.1')" in source
