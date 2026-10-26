// Release builds on Windows: no extra console window behind the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    stagegremlin_lib::run()
}
