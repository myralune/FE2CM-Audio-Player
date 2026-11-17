//! WebView2-specific helpers: running script *with a result* (Tauri's `eval`
//! is fire-and-forget) and muting the page's audio.

use tauri::WebviewWindow;

#[cfg(windows)]
pub fn eval_with_result<F>(window: &WebviewWindow, js: &str, on_result: F)
where
    F: FnOnce(String) + Send + 'static,
{
    use webview2_com::ExecuteScriptCompletedHandler;
    use windows::core::HSTRING;

    let js = HSTRING::from(js);
    let _ = window.with_webview(move |wv| unsafe {
        let Ok(core) = wv.controller().CoreWebView2() else {
            return;
        };
        let handler = ExecuteScriptCompletedHandler::create(Box::new(move |err, result| {
            if err.is_ok() {
                on_result(result);
            }
            Ok(())
        }));
        let _ = core.ExecuteScript(&js, &handler);
    });
}

#[cfg(not(windows))]
pub fn eval_with_result<F>(_window: &WebviewWindow, _js: &str, _on_result: F)
where
    F: FnOnce(String) + Send + 'static,
{
}

#[cfg(windows)]
pub fn set_muted(window: &WebviewWindow, mute: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
    use windows::core::Interface;

    let _ = window.with_webview(move |wv| unsafe {
        if let Ok(core) = wv.controller().CoreWebView2() {
            if let Ok(core8) = core.cast::<ICoreWebView2_8>() {
                let _ = core8.SetIsMuted(mute);
            }
        }
    });
}
