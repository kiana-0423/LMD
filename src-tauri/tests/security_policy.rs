//! Guards the shipped Content Security Policy.
//!
//! The policy is the app's main containment boundary, so a directive must not be relaxed by
//! accident. Each assertion here records why the directive is what it is.

use serde_json::Value;

fn csp() -> String {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("tauri.conf.json should be valid JSON");
    config["app"]["security"]["csp"]
        .as_str()
        .expect("a CSP must be configured")
        .to_string()
}

#[test]
fn a_content_security_policy_is_configured() {
    let policy = csp();
    assert!(!policy.trim().is_empty());
    assert!(policy.contains("default-src 'self'"));
}

#[test]
fn scripts_may_compile_webassembly_but_not_evaluate_javascript() {
    let policy = csp();
    // Ketcher's bundled indigo worker calls WebAssembly.instantiate, which needs
    // 'wasm-unsafe-eval'. Nothing in the built output calls eval() or the Function constructor,
    // so the far broader 'unsafe-eval' must not come back.
    assert!(policy.contains("'wasm-unsafe-eval'"));
    assert!(
        !policy.contains("'unsafe-eval'") || policy.contains("'wasm-unsafe-eval'"),
        "'unsafe-eval' allows arbitrary JavaScript evaluation and is not required"
    );
    for token in [" 'unsafe-eval'", "'unsafe-eval' "] {
        assert!(
            !policy.replace("'wasm-unsafe-eval'", "").contains(token),
            "'unsafe-eval' must not be granted"
        );
    }
}

#[test]
fn network_and_object_directives_stay_locked_down() {
    let policy = csp();
    assert!(policy.contains("object-src 'none'"));
    assert!(policy.contains("frame-src 'none'"));
    assert!(policy.contains("base-uri 'self'"));
    // The IPC endpoints are the only permitted network destinations; no remote host may be added.
    assert!(policy.contains("connect-src 'self' ipc:"));
    assert!(!policy.contains("connect-src *"));
    assert!(!policy.contains("https://*"));
}

#[test]
fn the_frontend_holds_no_shell_permission() {
    let capabilities: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("capabilities should be valid JSON");
    let permissions = capabilities["permissions"]
        .as_array()
        .expect("permissions should be a list");
    for permission in permissions {
        let name = permission.as_str().unwrap_or_default();
        assert!(
            !name.starts_with("shell:"),
            "the frontend must not be granted shell access, found '{name}'"
        );
    }
}

#[test]
fn the_frontend_holds_no_filesystem_permission() {
    // Native dialogs return a path the *backend* then validates against the workspace. Granting
    // `fs:` as well would let the interface read and write anywhere on the machine, which is a
    // much larger grant than "let the user pick a file".
    let capabilities: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("capabilities should be valid JSON");
    for permission in capabilities["permissions"]
        .as_array()
        .expect("permissions should be a list")
    {
        let name = permission.as_str().unwrap_or_default();
        assert!(
            !name.starts_with("fs:"),
            "the frontend must not be granted filesystem access, found '{name}'"
        );
    }
}

#[test]
fn the_dialog_permission_is_narrowed_to_choosing_files() {
    let capabilities: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("capabilities should be valid JSON");
    let permissions: Vec<&str> = capabilities["permissions"]
        .as_array()
        .expect("permissions should be a list")
        .iter()
        .map(|permission| permission.as_str().unwrap_or_default())
        .collect();

    // Exactly the two the interface uses. `dialog:default` would additionally grant `ask`,
    // `confirm` and `message`, which LMD renders itself and does not need from the platform.
    assert!(permissions.contains(&"dialog:allow-open"));
    assert!(permissions.contains(&"dialog:allow-save"));
    assert!(
        !permissions.contains(&"dialog:default"),
        "the broad dialog permission set is not required"
    );
}

#[test]
fn worker_and_wasm_sources_stay_local() {
    // The Indigo engine is loaded as a separate worker and .wasm asset rather than a Base64 blob,
    // so the policy has to permit both — from the application's own origin only.
    let policy = csp();
    assert!(policy.contains("worker-src 'self' blob:"));
    assert!(policy.contains("script-src 'self' 'wasm-unsafe-eval' blob:"));
    assert!(!policy.contains("worker-src *"));
}
