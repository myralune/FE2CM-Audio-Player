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
        // Failures still answer, with "null", so callers waiting on a result never hang.
        let handler = ExecuteScriptCompletedHandler::create(Box::new(move |err, result| {
            on_result(if err.is_ok() { result } else { "null".into() });
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

/// Calls `on_done(success, web_error_status, http_status)` after every top-level navigation.
#[cfg(windows)]
pub fn on_navigation_completed<F>(window: &WebviewWindow, on_done: F)
where
    F: Fn(bool, i32, i32) + Send + 'static,
{
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_WEB_ERROR_STATUS, ICoreWebView2NavigationCompletedEventArgs2,
    };
    use webview2_com::NavigationCompletedEventHandler;
    use windows::core::{BOOL, Interface};

    let _ = window.with_webview(move |wv| unsafe {
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let handler = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut ok = BOOL(0);
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS(0);
            let _ = args.IsSuccess(&mut ok);
            let _ = args.WebErrorStatus(&mut status);
            let mut http = -1;
            if let Ok(args2) = args.cast::<ICoreWebView2NavigationCompletedEventArgs2>() {
                let _ = args2.HttpStatusCode(&mut http);
            }
            on_done(ok.as_bool(), status.0, http);
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_NavigationCompleted(&handler, &mut token);
    });
}

#[cfg(not(windows))]
pub fn on_navigation_completed<F>(_window: &WebviewWindow, _on_done: F)
where
    F: Fn(bool, i32, i32) + Send + 'static,
{
}

pub fn web_error_name(status: i32) -> &'static str {
    match status {
        1 => "CERTIFICATE_COMMON_NAME_IS_INCORRECT",
        2 => "CERTIFICATE_EXPIRED",
        3 => "CLIENT_CERTIFICATE_CONTAINS_ERRORS",
        4 => "CERTIFICATE_REVOKED",
        5 => "CERTIFICATE_IS_INVALID",
        6 => "SERVER_UNREACHABLE",
        7 => "TIMEOUT",
        8 => "ERROR_HTTP_INVALID_SERVER_RESPONSE",
        9 => "CONNECTION_ABORTED",
        10 => "CONNECTION_RESET",
        11 => "DISCONNECTED",
        12 => "CANNOT_CONNECT",
        13 => "HOST_NAME_NOT_RESOLVED",
        14 => "OPERATION_CANCELED",
        15 => "REDIRECT_FAILED",
        16 => "UNEXPECTED_ERROR",
        17 => "VALID_AUTHENTICATION_CREDENTIALS_REQUIRED",
        18 => "VALID_PROXY_AUTHENTICATION_REQUIRED",
        _ => "UNKNOWN",
    }
}

/// Reports WebView2's own (muted, playing audio) flags for the page.
#[cfg(windows)]
pub fn audio_flags<F>(window: &WebviewWindow, on_result: F)
where
    F: FnOnce(bool, bool) + Send + 'static,
{
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
    use windows::core::{BOOL, Interface};

    let _ = window.with_webview(move |wv| unsafe {
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let Ok(core8) = core.cast::<ICoreWebView2_8>() else { return };
        let mut muted = BOOL(0);
        let mut playing = BOOL(0);
        if core8.IsMuted(&mut muted).is_ok() && core8.IsDocumentPlayingAudio(&mut playing).is_ok() {
            on_result(muted.as_bool(), playing.as_bool());
        }
    });
}

#[cfg(not(windows))]
pub fn audio_flags<F>(_window: &WebviewWindow, _on_result: F)
where
    F: FnOnce(bool, bool) + Send + 'static,
{
}

#[cfg(windows)]
pub fn runtime_version() -> String {
    use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
    use windows::core::{PCWSTR, PWSTR};

    let mut version = PWSTR::null();
    match unsafe { GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut version) } {
        Ok(()) => webview2_com::take_pwstr(version),
        Err(e) => format!("unavailable ({e})"),
    }
}

#[cfg(not(windows))]
pub fn runtime_version() -> String {
    "n/a".into()
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
