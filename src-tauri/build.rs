fn main() {
    // `cueplay-bg` is a tiny plugin inside this app holding one command (`report`) that the
    // background player's web page may call. Declaring it here generates the permission
    // `cueplay-bg:allow-report`, used in capabilities/background.json. See src/background/mod.rs.
    let attributes = tauri_build::Attributes::new()
        .plugin("cueplay-bg", tauri_build::InlinedPlugin::new().commands(&["report"]));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
