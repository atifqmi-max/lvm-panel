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



def test_api_vps_creation_uses_real_backend_instead_of_success_stub():
    source = (ROOT / "api.py").read_text(encoding="utf-8")
    assert "Full implementation requires integration with nrb.py VPS creation logic" not in source
    start = source.index("def api_create_vps():")
    end = source.index("@api_bp.route('/vps/<int:vps_id>/start'", start)
    route = source[start:end]
    assert "execute_container(" in route
    assert "apply_lxd_config(" in route
    assert "create_vps(" in route
    assert "VPS created successfully" in route


def test_installer_has_health_check_and_transactional_update_rollback():
    source = (ROOT / "install.sh").read_text(encoding="utf-8")
    assert "wait_for_health" in source
    assert "/api/v1/health" in source
    assert "restoring the previous application files" in source
    assert "Rollback archive:" in source
    assert "bash -n \"$tmp/source/install.sh\"" in source
    for choice in range(0, 12):
        assert f"{choice})" in source or f"{choice:2d})" in source


def test_os_icon_delete_button_calls_backend():
    source = (ROOT / "templates/admin/os_icons.html").read_text(encoding="utf-8")
    assert "async function deleteIcon(osName)" in source
    assert "fetch(`/os-icons/${osName}/delete`" in source
    assert "Delete functionality not implemented yet" not in source


def test_api_resource_amount_parser_accepts_valid_values_and_rejects_bad_values():
    from api import _parse_resource_amount

    assert _parse_resource_amount(2, "RAM") == 2
    assert _parse_resource_amount("4GB", "RAM") == 4
    assert _parse_resource_amount(" 8 g ", "RAM") == 8
    for value in (None, True, False, 0, -1, "1.5GB", "2 CPUs", "abc", ""):
        try:
            _parse_resource_amount(value, "RAM")
        except ValueError:
            continue
        raise AssertionError(f"Expected invalid resource amount to be rejected: {value!r}")
