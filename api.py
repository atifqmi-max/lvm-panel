#!/usr/bin/env python3
"""
NRB Panel - Comprehensive REST API
Full management API for NRB Panel
"""

from flask import Blueprint, request, jsonify
from functools import wraps
import secrets
import hashlib
from datetime import datetime
import logging
import ipaddress
import re

# Create API blueprint
api_bp = Blueprint('api', __name__, url_prefix='/api/v1')

logger = logging.getLogger(__name__)

# ============================================================================
# API Authentication Decorator
# ============================================================================

def require_api_key(f):
    """Decorator to require API key authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        from nrb import get_db
        
        # API keys must be sent in a header; URLs are commonly logged and leaked via history/referrers.
        api_key = request.headers.get('X-API-Key')
        
        if not api_key:
            return jsonify({
                'success': False,
                'error': 'API key required',
                'message': 'Provide the API key in the X-API-Key header'
            }), 401
        
        # Validate API key
        try:
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute('''SELECT u.*, ak.* FROM api_keys ak
                              JOIN users u ON ak.user_id = u.id
                              WHERE ak.key = ? AND ak.is_active = 1''', (api_key,))
                result = cur.fetchone()
                
                if not result:
                    return jsonify({
                        'success': False,
                        'error': 'Invalid API key',
                        'message': 'API key not found or inactive'
                    }), 401
                
                # Update last used timestamp
                cur.execute('UPDATE api_keys SET last_used_at = ? WHERE key = ?',
                           (datetime.now().isoformat(), api_key))
                conn.commit()
                
                # Store user info in request context
                request.api_user = dict(result)
                request.api_key_info = {
                    'key_id': result['id'],
                    'user_id': result['user_id'],
                    'is_admin': result['is_admin']
                }
                
        except Exception as e:
            logger.error(f"API key validation error: {e}")
            return jsonify({
                'success': False,
                'error': 'Authentication error'
            }), 500
        
        return f(*args, **kwargs)
    
    return decorated_function

def require_admin_api(f):
    """Decorator to require admin API key"""
    @wraps(f)
    @require_api_key
    def decorated_function(*args, **kwargs):
        if not request.api_key_info.get('is_admin'):
            return jsonify({
                'success': False,
                'error': 'Admin access required',
                'message': 'This endpoint requires admin privileges'
            }), 403
        
        return f(*args, **kwargs)
    
    return decorated_function

# ============================================================================
# API Info & Health
# ============================================================================

@api_bp.route('/info', methods=['GET'])
def api_info():
    """Get API information"""
    return jsonify({
        'success': True,
        'api': {
            'name': 'NRB Panel API',
            'version': 'v1',
            'description': 'Comprehensive REST API for NRB Panel management',
            'documentation': '/api/v1/docs',
            'endpoints': {
                'authentication': '/api/v1/auth/*',
                'users': '/api/v1/users/*',
                'vps': '/api/v1/vps/*',
                'nodes': '/api/v1/nodes/*',
                'system': '/api/v1/system/*'
            }
        }
    })

@api_bp.route('/health', methods=['GET'])
def api_health():
    """Health check endpoint"""
    return jsonify({
        'success': True,
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    })

# ============================================================================
# User Management API
# ============================================================================

@api_bp.route('/users', methods=['GET'])
@require_admin_api
def api_list_users():
    """List all users"""
    from nrb import get_db
    
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('''SELECT id, username, email, is_admin, created_at, last_login
                          FROM users ORDER BY id''')
            users = [dict(row) for row in cur.fetchall()]
        
        return jsonify({
            'success': True,
            'users': users,
            'count': len(users)
        })
    except Exception as e:
        logger.error(f"API list users error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/users/<int:user_id>', methods=['GET'])
@require_admin_api
def api_get_user(user_id):
    """Get user details"""
    from nrb import get_db
    
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('''SELECT id, username, email, is_admin, created_at, last_login, last_active
                          FROM users WHERE id = ?''', (user_id,))
            user = cur.fetchone()
            
            if not user:
                return jsonify({'success': False, 'error': 'User not found'}), 404
            
            # Get user's VPS count
            cur.execute('SELECT COUNT(*) FROM vps WHERE user_id = ?', (user_id,))
            vps_count = cur.fetchone()[0]
            
            user_data = dict(user)
            user_data['vps_count'] = vps_count
        
        return jsonify({
            'success': True,
            'user': user_data
        })
    except Exception as e:
        logger.error(f"API get user error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/users', methods=['POST'])
@require_admin_api
def api_create_user():
    """Create new user"""
    from nrb import get_db
    from werkzeug.security import generate_password_hash
    
    try:
        data = request.get_json()
        
        username = data.get('username')
        email = data.get('email')
        password = data.get('password')
        is_admin = data.get('is_admin', False)
        
        if not username or not email or not password:
            return jsonify({
                'success': False,
                'error': 'Missing required fields',
                'required': ['username', 'email', 'password']
            }), 400
        
        password_hash = generate_password_hash(password)
        now = datetime.now().isoformat()
        
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('''INSERT INTO users (username, email, password_hash, is_admin, created_at)
                          VALUES (?, ?, ?, ?, ?)''',
                       (username, email, password_hash, 1 if is_admin else 0, now))
            conn.commit()
            user_id = cur.lastrowid
        
        return jsonify({
            'success': True,
            'user_id': user_id,
            'message': 'User created successfully'
        }), 201
    except Exception as e:
        logger.error(f"API create user error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/users/<int:user_id>', methods=['PUT', 'PATCH'])
@require_admin_api
def api_update_user(user_id):
    """Update user"""
    from nrb import get_db
    from werkzeug.security import generate_password_hash
    
    try:
        data = request.get_json()
        
        with get_db() as conn:
            cur = conn.cursor()
            
            if 'email' in data:
                cur.execute('UPDATE users SET email = ? WHERE id = ?', (data['email'], user_id))
            
            if 'password' in data:
                password_hash = generate_password_hash(data['password'])
                cur.execute('UPDATE users SET password_hash = ? WHERE id = ?', (password_hash, user_id))
            
            if 'is_admin' in data:
                cur.execute('UPDATE users SET is_admin = ? WHERE id = ?', 
                           (1 if data['is_admin'] else 0, user_id))
            
            conn.commit()
        
        return jsonify({
            'success': True,
            'message': 'User updated successfully'
        })
    except Exception as e:
        logger.error(f"API update user error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/users/<int:user_id>', methods=['DELETE'])
@require_admin_api
def api_delete_user(user_id):
    """Delete user"""
    from nrb import get_db
    
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('DELETE FROM users WHERE id = ?', (user_id,))
            conn.commit()
        
        return jsonify({
            'success': True,
            'message': 'User deleted successfully'
        })
    except Exception as e:
        logger.error(f"API delete user error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

# ============================================================================
# VPS Management API
# ============================================================================

@api_bp.route('/vps', methods=['GET'])
@require_api_key
def api_list_vps():
    """List VPS (user's own or all if admin)"""
    from nrb import get_db
    
    try:
        with get_db() as conn:
            cur = conn.cursor()
            
            if request.api_key_info['is_admin']:
                # Admin sees all VPS
                cur.execute('''SELECT v.*, u.username, n.name as node_name
                              FROM vps v
                              LEFT JOIN users u ON v.user_id = u.id
                              LEFT JOIN nodes n ON v.node_id = n.id
                              ORDER BY v.created_at DESC''')
            else:
                # User sees only their VPS
                cur.execute('''SELECT v.*, n.name as node_name
                              FROM vps v
                              LEFT JOIN nodes n ON v.node_id = n.id
                              WHERE v.user_id = ?
                              ORDER BY v.created_at DESC''',
                           (request.api_key_info['user_id'],))
            
            vps_list = [dict(row) for row in cur.fetchall()]
        
        return jsonify({
            'success': True,
            'vps': vps_list,
            'count': len(vps_list)
        })
    except Exception as e:
        logger.error(f"API list VPS error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/vps/<int:vps_id>', methods=['GET'])
@require_api_key
def api_get_vps(vps_id):
    """Get VPS details"""
    from nrb import get_db, get_vps_by_id, run_sync, get_container_stats
    
    try:
        vps = get_vps_by_id(vps_id)
        
        if not vps:
            return jsonify({'success': False, 'error': 'VPS not found'}), 404
        
        # Check access
        if not request.api_key_info['is_admin'] and vps['user_id'] != request.api_key_info['user_id']:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
        
        # Get live stats
        try:
            stats = run_sync(get_container_stats(vps['container_name'], vps['node_id']))
            vps['stats'] = stats
        except:
            vps['stats'] = None
        
        return jsonify({
            'success': True,
            'vps': vps
        })
    except Exception as e:
        logger.error(f"API get VPS error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

def _parse_resource_amount(value, field):
    """Parse a positive integer resource amount, accepting values such as 2 or '2GB'."""
    if isinstance(value, bool) or value is None:
        raise ValueError(f"{field} must be a positive whole number")
    match = re.fullmatch(r"\s*(\d+)\s*(?:GB|G)?\s*", str(value), flags=re.IGNORECASE)
    if not match:
        raise ValueError(f"{field} must be a positive whole number")
    amount = int(match.group(1))
    if amount < 1:
        raise ValueError(f"{field} must be a positive whole number")
    return amount


@api_bp.route('/vps', methods=['POST'])
@require_admin_api
def api_create_vps():
    """Create a real LXD-backed VPS using the same backend as the admin panel."""
    from nrb import (
        OS_OPTIONS, get_db, get_node, get_current_vps_count, get_vps_for_user,
        get_setting, run_sync, execute_container, apply_lxd_config,
        configure_container_ip, configure_ssh_and_root_password,
        configure_tailscale, create_vps, update_vps, delete_vps,
        encrypt_vps_ssh_password, log_activity,
    )

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'success': False, 'error': 'A JSON object is required'}), 400

    try:
        user_id = int(data.get('user_id', 0))
        node_id = int(data.get('node_id', 0))
        cpu = _parse_resource_amount(data.get('cpu'), 'CPU')
        ram = _parse_resource_amount(data.get('ram'), 'RAM')
        disk = _parse_resource_amount(data.get('storage'), 'Storage')
    except (TypeError, ValueError) as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400

    if user_id < 1 or node_id < 1:
        return jsonify({'success': False, 'error': 'Valid user_id and node_id are required'}), 400
    if not 1 <= cpu <= 64:
        return jsonify({'success': False, 'error': 'CPU must be between 1 and 64 cores'}), 400
    if not 1 <= ram <= 128:
        return jsonify({'success': False, 'error': 'RAM must be between 1 and 128 GB'}), 400
    if not 5 <= disk <= 2000:
        return jsonify({'success': False, 'error': 'Storage must be between 5 and 2000 GB'}), 400
    try:
        expiration_days = int(data.get('expiration_days') or 0)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'expiration_days must be a whole number'}), 400
    if not 0 <= expiration_days <= 3650:
        return jsonify({'success': False, 'error': 'expiration_days must be between 0 and 3650'}), 400
    auto_suspend_value = data.get('auto_suspend_enabled', False)
    if isinstance(auto_suspend_value, str):
        auto_suspend_enabled = auto_suspend_value.strip().lower() in {'1', 'true', 'yes', 'on'}
    else:
        auto_suspend_enabled = bool(auto_suspend_value)

    os_version = str(data.get('os_version', '')).strip()
    if os_version not in {item['value'] for item in OS_OPTIONS}:
        return jsonify({'success': False, 'error': 'Unsupported OS image'}), 400

    raw_hostname = str(data.get('hostname') or '').strip().lower()
    if len(raw_hostname) > 63:
        return jsonify({'success': False, 'error': 'Hostname must be 63 characters or fewer'}), 400
    slug = re.sub(r'[^a-z0-9-]+', '-', raw_hostname).strip('-')[:30].strip('-')
    if raw_hostname and not slug:
        return jsonify({'success': False, 'error': 'Hostname must contain letters or numbers'}), 400

    ip_address = str(data.get('ip_address') or '').strip() or None
    ip_alias = str(data.get('ip_alias') or '').strip() or None
    if ip_address:
        try:
            ipaddress.ip_address(ip_address)
        except ValueError:
            return jsonify({'success': False, 'error': 'Invalid IP address'}), 400

    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('SELECT id FROM users WHERE id = ?', (user_id,))
            if not cur.fetchone():
                return jsonify({'success': False, 'error': 'User not found'}), 404

        node = get_node(node_id)
        if not node:
            return jsonify({'success': False, 'error': 'Node not found'}), 404

        capacity = int(node.get('total_vps') or 0)
        if get_current_vps_count(node_id) >= capacity:
            return jsonify({'success': False, 'error': 'Node at full capacity'}), 409

        try:
            max_vps = max(1, int(get_setting('max_vps_per_user', '10')))
        except (TypeError, ValueError):
            max_vps = 10
        if len(get_vps_for_user(user_id)) >= max_vps:
            return jsonify({'success': False, 'error': f'User has reached maximum VPS limit ({max_vps})'}), 409
    except Exception:
        logger.exception('API VPS preflight failed')
        return jsonify({'success': False, 'error': 'Could not validate VPS capacity'}), 500

    container_name = f"{slug or 'vps'}-u{user_id}-{secrets.token_hex(3)}"
    created_container = False
    vps_id = None
    try:
        # Attempt cleanup even if LXD reports a partial failure during init.
        created_container = True
        run_sync(execute_container(
            container_name,
            f"init {os_version} {container_name} -m {ram * 1024}MB -c {cpu} -d {disk}GB",
            node_id=node_id,
        ))
        run_sync(apply_lxd_config(container_name, node_id))
        run_sync(execute_container(container_name, f"start {container_name}", node_id=node_id))

        if ip_address:
            run_sync(configure_container_ip(container_name, ip_address, node_id))

        ssh_password = run_sync(configure_ssh_and_root_password(container_name, node_id))
        tailscale_info = run_sync(configure_tailscale(container_name, node_id))

        vps_id = create_vps(
            user_id=user_id,
            node_id=node_id,
            container_name=container_name,
            hostname=raw_hostname or container_name,
            ram=f"{ram}GB",
            cpu=str(cpu),
            storage=f"{disk}GB",
            config=f"{ram}GB RAM / {cpu} CPU / {disk}GB Disk",
            os_version=os_version,
            ip_address=ip_address,
            ip_alias=ip_alias,
            expiration_days=expiration_days,
            auto_suspend_enabled=auto_suspend_enabled,
        )
        metadata = {'tailscale': tailscale_info}
        if ssh_password:
            metadata['ssh_password_encrypted'] = encrypt_vps_ssh_password(ssh_password)
        update_vps(vps_id, metadata=metadata)
        log_activity(
            request.api_key_info['user_id'],
            'api_create_vps',
            'vps',
            str(vps_id),
            {'owner_id': user_id, 'node_id': node_id, 'container': container_name},
        )
        return jsonify({
            'success': True,
            'message': 'VPS created successfully',
            'vps_id': vps_id,
            'container_name': container_name,
            'ssh_ready': bool(ssh_password),
        }), 201
    except Exception:
        logger.exception('API VPS creation failed')
        if vps_id is not None:
            try:
                delete_vps(vps_id)
            except Exception:
                logger.exception('Could not roll back VPS database record %s', vps_id)
        if created_container:
            try:
                run_sync(execute_container(container_name, f"delete {container_name} --force", node_id=node_id))
            except Exception:
                logger.exception('Could not roll back LXD container %s', container_name)
        return jsonify({'success': False, 'error': 'VPS creation failed; check panel logs'}), 500

@api_bp.route('/vps/<int:vps_id>/start', methods=['POST'])
@require_api_key
def api_start_vps(vps_id):
    """Start VPS"""
    from nrb import get_vps_by_id, run_sync, execute_container
    
    try:
        vps = get_vps_by_id(vps_id)
        
        if not vps:
            return jsonify({'success': False, 'error': 'VPS not found'}), 404
        
        # Check access
        if not request.api_key_info['is_admin'] and vps['user_id'] != request.api_key_info['user_id']:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
        
        # Start VPS
        run_sync(execute_container(vps['container_name'], f"start {vps['container_name']}", node_id=vps['node_id']))
        
        return jsonify({
            'success': True,
            'message': 'VPS started successfully'
        })
    except Exception as e:
        logger.error(f"API start VPS error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/vps/<int:vps_id>/stop', methods=['POST'])
@require_api_key
def api_stop_vps(vps_id):
    """Stop VPS"""
    from nrb import get_vps_by_id, run_sync, execute_container
    
    try:
        vps = get_vps_by_id(vps_id)
        
        if not vps:
            return jsonify({'success': False, 'error': 'VPS not found'}), 404
        
        # Check access
        if not request.api_key_info['is_admin'] and vps['user_id'] != request.api_key_info['user_id']:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
        
        # Stop VPS
        run_sync(execute_container(vps['container_name'], f"stop {vps['container_name']}", node_id=vps['node_id']))
        
        return jsonify({
            'success': True,
            'message': 'VPS stopped successfully'
        })
    except Exception as e:
        logger.error(f"API stop VPS error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/vps/<int:vps_id>/restart', methods=['POST'])
@require_api_key
def api_restart_vps(vps_id):
    """Restart VPS"""
    from nrb import get_vps_by_id, run_sync, execute_container
    
    try:
        vps = get_vps_by_id(vps_id)
        
        if not vps:
            return jsonify({'success': False, 'error': 'VPS not found'}), 404
        
        # Check access
        if not request.api_key_info['is_admin'] and vps['user_id'] != request.api_key_info['user_id']:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
        
        # Restart VPS
        run_sync(execute_container(vps['container_name'], f"restart {vps['container_name']}", node_id=vps['node_id']))
        
        return jsonify({
            'success': True,
            'message': 'VPS restarted successfully'
        })
    except Exception as e:
        logger.error(f"API restart VPS error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/vps/<int:vps_id>', methods=['DELETE'])
@require_admin_api
def api_delete_vps(vps_id):
    """Delete VPS"""
    from nrb import get_db, get_vps_by_id, run_sync, execute_container
    
    try:
        vps = get_vps_by_id(vps_id)
        
        if not vps:
            return jsonify({'success': False, 'error': 'VPS not found'}), 404
        
        # Delete container
        try:
            run_sync(execute_container(vps['container_name'], f"delete {vps['container_name']} --force", node_id=vps['node_id']))
        except:
            pass
        
        # Delete from database
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('DELETE FROM vps WHERE id = ?', (vps_id,))
            conn.commit()
        
        return jsonify({
            'success': True,
            'message': 'VPS deleted successfully'
        })
    except Exception as e:
        logger.error(f"API delete VPS error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

# ============================================================================
# Node Management API
# ============================================================================

@api_bp.route('/nodes', methods=['GET'])
@require_admin_api
def api_list_nodes():
    """List all nodes"""
    from nrb import get_nodes
    
    try:
        nodes = get_nodes()
        
        return jsonify({
            'success': True,
            'nodes': nodes,
            'count': len(nodes)
        })
    except Exception as e:
        logger.error(f"API list nodes error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/nodes/<int:node_id>', methods=['GET'])
@require_admin_api
def api_get_node(node_id):
    """Get node details"""
    from nrb import get_node, run_sync, get_host_stats
    
    try:
        node = get_node(node_id)
        
        if not node:
            return jsonify({'success': False, 'error': 'Node not found'}), 404
        
        # Get node stats
        try:
            stats = run_sync(get_host_stats(node_id))
            node['stats'] = stats
        except:
            node['stats'] = None
        
        return jsonify({
            'success': True,
            'node': node
        })
    except Exception as e:
        logger.error(f"API get node error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

# ============================================================================
# System API
# ============================================================================

@api_bp.route('/system/info', methods=['GET'])
@require_admin_api
def api_system_info():
    """Get system information"""
    from nrb import get_host_cpu_usage, get_host_ram_usage, get_host_disk_usage, get_host_uptime
    import platform
    
    try:
        system_info = {
            'hostname': platform.node(),
            'platform': platform.platform(),
            'python_version': platform.python_version(),
            'cpu': {
                'cores': __import__('os').cpu_count(),
                'usage': get_host_cpu_usage()
            },
            'memory': get_host_ram_usage(),
            'disk': get_host_disk_usage(),
            'uptime': get_host_uptime()
        }
        
        return jsonify({
            'success': True,
            'system': system_info
        })
    except Exception as e:
        logger.error(f"API system info error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/system/stats', methods=['GET'])
@require_admin_api
def api_system_stats():
    """Get system statistics"""
    from nrb import get_db
    
    try:
        with get_db() as conn:
            cur = conn.cursor()
            
            cur.execute('SELECT COUNT(*) FROM users')
            total_users = cur.fetchone()[0]
            
            cur.execute('SELECT COUNT(*) FROM vps')
            total_vps = cur.fetchone()[0]
            
            cur.execute('SELECT COUNT(*) FROM vps WHERE status = "running"')
            running_vps = cur.fetchone()[0]
            
            cur.execute('SELECT COUNT(*) FROM nodes')
            total_nodes = cur.fetchone()[0]
        
        return jsonify({
            'success': True,
            'stats': {
                'users': total_users,
                'vps': {
                    'total': total_vps,
                    'running': running_vps,
                    'stopped': total_vps - running_vps
                },
                'nodes': total_nodes
            }
        })
    except Exception as e:
        logger.error(f"API system stats error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

# ============================================================================
# VPS Extended Management API
# ============================================================================

@api_bp.route('/vps/<int:vps_id>/suspend', methods=['POST'])
@require_admin_api
def api_suspend_vps(vps_id):
    """Suspend VPS"""
    from nrb import get_db, get_vps_by_id, run_sync, execute_container
    
    try:
        data = request.get_json() or {}
        reason = data.get('reason', 'Suspended by admin via API')
        
        vps = get_vps_by_id(vps_id)
        if not vps:
            return jsonify({'success': False, 'error': 'VPS not found'}), 404
        
        # Stop VPS
        try:
            run_sync(execute_container(vps['container_name'], f"stop {vps['container_name']} --force", node_id=vps['node_id']))
        except:
            pass
        
        # Update database
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('UPDATE vps SET suspended = 1, suspended_reason = ?, status = "stopped" WHERE id = ?',
                       (reason, vps_id))
            conn.commit()
        
        return jsonify({
            'success': True,
            'message': 'VPS suspended successfully'
        })
    except Exception as e:
        logger.error(f"API suspend VPS error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/vps/<int:vps_id>/unsuspend', methods=['POST'])
@require_admin_api
def api_unsuspend_vps(vps_id):
    """Unsuspend VPS"""
    from nrb import get_db
    
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('UPDATE vps SET suspended = 0, suspended_reason = NULL WHERE id = ?', (vps_id,))
            conn.commit()
        
        return jsonify({
            'success': True,
            'message': 'VPS unsuspended successfully'
        })
    except Exception as e:
        logger.error(f"API unsuspend VPS error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/vps/<int:vps_id>/resize', methods=['POST'])
@require_admin_api
def api_resize_vps(vps_id):
    """Resize VPS resources"""
    from nrb import get_db, get_vps_by_id
    
    try:
        data = request.get_json() or {}
        
        vps = get_vps_by_id(vps_id)
        if not vps:
            return jsonify({'success': False, 'error': 'VPS not found'}), 404
        
        with get_db() as conn:
            cur = conn.cursor()
            
            if 'cpu' in data:
                cur.execute('UPDATE vps SET cpu = ? WHERE id = ?', (data['cpu'], vps_id))
            
            if 'ram' in data:
                cur.execute('UPDATE vps SET ram = ? WHERE id = ?', (data['ram'], vps_id))
            
            if 'storage' in data:
                cur.execute('UPDATE vps SET storage = ? WHERE id = ?', (data['storage'], vps_id))
            
            conn.commit()
        
        return jsonify({
            'success': True,
            'message': 'VPS resized successfully (restart required for changes to take effect)'
        })
    except Exception as e:
        logger.error(f"API resize VPS error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/vps/<int:vps_id>/execute', methods=['POST'])
@require_api_key
def api_execute_command(vps_id):
    """Execute command in VPS"""
    from nrb import get_vps_by_id, run_sync, execute_container
    
    try:
        data = request.get_json() or {}
        command = data.get('command')
        
        if not command:
            return jsonify({'success': False, 'error': 'command required'}), 400
        
        vps = get_vps_by_id(vps_id)
        if not vps:
            return jsonify({'success': False, 'error': 'VPS not found'}), 404
        
        # Check access
        if not request.api_key_info['is_admin'] and vps['user_id'] != request.api_key_info['user_id']:
            return jsonify({'success': False, 'error': 'Access denied'}), 403
        
        # Execute command
        result = run_sync(execute_container(vps['container_name'], f"exec {vps['container_name']} -- {command}", node_id=vps['node_id']))
        
        return jsonify({
            'success': True,
            'output': result
        })
    except Exception as e:
        logger.error(f"API execute command error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

# ============================================================================
# Node Extended Management API
# ============================================================================

@api_bp.route('/nodes', methods=['POST'])
@require_admin_api
def api_create_node():
    """Create new node"""
    from nrb import get_db
    
    try:
        data = request.get_json() or {}
        
        name = data.get('name')
        url = data.get('url')
        location = data.get('location', '')
        api_key = data.get('api_key')
        
        if not name or not url:
            return jsonify({
                'success': False,
                'error': 'Missing required fields',
                'required': ['name', 'url']
            }), 400
        
        now = datetime.now().isoformat()
        
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('''INSERT INTO nodes (name, url, location, api_key, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?)''',
                       (name, url, location, api_key, now, now))
            conn.commit()
            node_id = cur.lastrowid
        
        return jsonify({
            'success': True,
            'node_id': node_id,
            'message': 'Node created successfully'
        }), 201
    except Exception as e:
        logger.error(f"API create node error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/nodes/<int:node_id>', methods=['PUT', 'PATCH'])
@require_admin_api
def api_update_node(node_id):
    """Update node"""
    from nrb import get_db
    
    try:
        data = request.get_json() or {}
        
        with get_db() as conn:
            cur = conn.cursor()
            
            if 'name' in data:
                cur.execute('UPDATE nodes SET name = ? WHERE id = ?', (data['name'], node_id))
            
            if 'url' in data:
                cur.execute('UPDATE nodes SET url = ? WHERE id = ?', (data['url'], node_id))
            
            if 'location' in data:
                cur.execute('UPDATE nodes SET location = ? WHERE id = ?', (data['location'], node_id))
            
            if 'api_key' in data:
                cur.execute('UPDATE nodes SET api_key = ? WHERE id = ?', (data['api_key'], node_id))
            
            cur.execute('UPDATE nodes SET updated_at = ? WHERE id = ?', (datetime.now().isoformat(), node_id))
            conn.commit()
        
        return jsonify({
            'success': True,
            'message': 'Node updated successfully'
        })
    except Exception as e:
        logger.error(f"API update node error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/nodes/<int:node_id>', methods=['DELETE'])
@require_admin_api
def api_delete_node(node_id):
    """Delete node"""
    from nrb import get_db
    
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('DELETE FROM nodes WHERE id = ?', (node_id,))
            conn.commit()
        
        return jsonify({
            'success': True,
            'message': 'Node deleted successfully'
        })
    except Exception as e:
        logger.error(f"API delete node error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

# ============================================================================
# Settings Management API
# ============================================================================

@api_bp.route('/settings', methods=['GET'])
@require_admin_api
def api_get_settings():
    """Get all settings"""
    from nrb import get_db
    
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute('SELECT key, value, description FROM settings')
            settings = {row['key']: {'value': row['value'], 'description': row['description']} 
                       for row in cur.fetchall()}
        
        return jsonify({
            'success': True,
            'settings': settings
        })
    except Exception as e:
        logger.error(f"API get settings error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/settings/<key>', methods=['GET'])
@require_admin_api
def api_get_setting(key):
    """Get specific setting"""
    from nrb import get_setting
    
    try:
        value = get_setting(key)
        
        if value is None:
            return jsonify({'success': False, 'error': 'Setting not found'}), 404
        
        return jsonify({
            'success': True,
            'key': key,
            'value': value
        })
    except Exception as e:
        logger.error(f"API get setting error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/settings/<key>', methods=['PUT', 'PATCH'])
@require_admin_api
def api_update_setting(key):
    """Update setting"""
    from nrb import set_setting
    
    try:
        data = request.get_json() or {}
        value = data.get('value')
        
        if value is None:
            return jsonify({'success': False, 'error': 'value required'}), 400
        
        set_setting(key, str(value))
        
        return jsonify({
            'success': True,
            'message': 'Setting updated successfully'
        })
    except Exception as e:
        logger.error(f"API update setting error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

# ============================================================================
# Maintenance Mode API
# ============================================================================

@api_bp.route('/maintenance/enable', methods=['POST'])
@require_admin_api
def api_enable_maintenance():
    """Enable maintenance mode"""
    from nrb import set_setting
    
    try:
        data = request.get_json() or {}
        message = data.get('message', 'Site is under maintenance. Please check back later.')
        
        set_setting('maintenance_mode', '1')
        set_setting('maintenance_message', message)
        
        return jsonify({
            'success': True,
            'message': 'Maintenance mode enabled'
        })
    except Exception as e:
        logger.error(f"API enable maintenance error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/maintenance/disable', methods=['POST'])
@require_admin_api
def api_disable_maintenance():
    """Disable maintenance mode"""
    from nrb import set_setting
    
    try:
        set_setting('maintenance_mode', '0')
        
        return jsonify({
            'success': True,
            'message': 'Maintenance mode disabled'
        })
    except Exception as e:
        logger.error(f"API disable maintenance error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

# ============================================================================
# Bulk Operations API
# ============================================================================

@api_bp.route('/vps/bulk/start', methods=['POST'])
@require_admin_api
def api_bulk_start_vps():
    """Start multiple VPS"""
    from nrb import get_db, run_sync, execute_container
    
    try:
        data = request.get_json() or {}
        vps_ids = data.get('vps_ids', [])
        
        if not vps_ids:
            return jsonify({'success': False, 'error': 'vps_ids required'}), 400
        
        started = []
        failed = []
        
        with get_db() as conn:
            cur = conn.cursor()
            for vps_id in vps_ids:
                cur.execute('SELECT * FROM vps WHERE id = ?', (vps_id,))
                vps = cur.fetchone()
                
                if vps:
                    try:
                        run_sync(execute_container(vps['container_name'], f"start {vps['container_name']}", node_id=vps['node_id']))
                        started.append(vps_id)
                    except Exception as e:
                        failed.append({'vps_id': vps_id, 'error': 'Operation failed'})
        
        return jsonify({
            'success': True,
            'started': started,
            'failed': failed,
            'message': f'Started {len(started)} VPS, {len(failed)} failed'
        })
    except Exception as e:
        logger.error(f"API bulk start VPS error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@api_bp.route('/vps/bulk/stop', methods=['POST'])
@require_admin_api
def api_bulk_stop_vps():
    """Stop multiple VPS"""
    from nrb import get_db, run_sync, execute_container
    
    try:
        data = request.get_json() or {}
        vps_ids = data.get('vps_ids', [])
        
        if not vps_ids:
            return jsonify({'success': False, 'error': 'vps_ids required'}), 400
        
        stopped = []
        failed = []
        
        with get_db() as conn:
            cur = conn.cursor()
            for vps_id in vps_ids:
                cur.execute('SELECT * FROM vps WHERE id = ?', (vps_id,))
                vps = cur.fetchone()
                
                if vps:
                    try:
                        run_sync(execute_container(vps['container_name'], f"stop {vps['container_name']}", node_id=vps['node_id']))
                        stopped.append(vps_id)
                    except Exception as e:
                        failed.append({'vps_id': vps_id, 'error': 'Operation failed'})
        
        return jsonify({
            'success': True,
            'stopped': stopped,
            'failed': failed,
            'message': f'Stopped {len(stopped)} VPS, {len(failed)} failed'
        })
    except Exception as e:
        logger.error(f"API bulk stop VPS error: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

# ============================================================================
# Error Handlers
# ============================================================================

@api_bp.errorhandler(404)
def api_not_found(error):
    return jsonify({
        'success': False,
        'error': 'Endpoint not found',
        'message': 'The requested API endpoint does not exist'
    }), 404

@api_bp.errorhandler(405)
def api_method_not_allowed(error):
    return jsonify({
        'success': False,
        'error': 'Method not allowed',
        'message': 'The HTTP method is not allowed for this endpoint'
    }), 405

@api_bp.errorhandler(500)
def api_internal_error(error):
    return jsonify({
        'success': False,
        'error': 'Internal server error',
        'message': 'An unexpected error occurred'
    }), 500