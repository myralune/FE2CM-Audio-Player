use std::sync::atomic::{AtomicU64, Ordering};

// The minimum height is derived from this so the ratio holds.
pub const MIN_WIDTH: f64 = 300.0;

// Width / height as f64 bits, 0 until the UI has measured itself.
static RATIO: AtomicU64 = AtomicU64::new(0);

pub fn set_ratio(width: f64, height: f64) {
    if width > 0.0 && height > 0.0 {
        RATIO.store((width / height).to_bits(), Ordering::Relaxed);
    }
}

#[allow(dead_code)]
fn ratio() -> f64 {
    f64::from_bits(RATIO.load(Ordering::Relaxed))
}

// A fixed minimum height would distort the ratio.
pub fn apply_min_size(window: &tauri::WebviewWindow, width: f64, height: f64) {
    if width > 0.0 && height > 0.0 {
        let _ = window.set_min_size(Some(tauri::LogicalSize::new(
            MIN_WIDTH,
            (MIN_WIDTH * height / width).round(),
        )));
    }
}

// Done in WM_SIZING because resizing after the fact makes top-edge drags creep up the screen.
#[cfg(windows)]
pub fn install(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::SetWindowSubclass;

    let Ok(raw) = window.hwnd() else { return };
    let hwnd = HWND(raw.0 as _);
    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(subclass_proc), 0xA59E, 0);
    }
}

#[cfg(not(windows))]
pub fn install(_window: &tauri::WebviewWindow) {}

#[cfg(windows)]
unsafe extern "system" fn subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::{LRESULT, RECT};
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowRect, WM_SIZING, WMSZ_BOTTOM, WMSZ_BOTTOMLEFT, WMSZ_BOTTOMRIGHT,
        WMSZ_LEFT, WMSZ_RIGHT, WMSZ_TOP, WMSZ_TOPLEFT, WMSZ_TOPRIGHT,
    };

    let r = ratio();
    if msg == WM_SIZING && r > 0.0 && lparam.0 != 0 {
        unsafe {
            // The ratio applies to the client area, so the frame is excluded.
            let mut win = RECT::default();
            let mut client = RECT::default();
            let (frame_w, frame_h) =
                if GetWindowRect(hwnd, &mut win).is_ok() && GetClientRect(hwnd, &mut client).is_ok() {
                    (
                        (win.right - win.left) - (client.right - client.left),
                        (win.bottom - win.top) - (client.bottom - client.top),
                    )
                } else {
                    (0, 0)
                };

            let rect = &mut *(lparam.0 as *mut RECT);
            let w = ((rect.right - rect.left) - frame_w).max(1) as f64;
            let h = ((rect.bottom - rect.top) - frame_h).max(1) as f64;
            let height_for_w = (w / r).round() as i32 + frame_h;
            let width_for_h = (h * r).round() as i32 + frame_w;

            match wparam.0 as u32 {
                WMSZ_TOP | WMSZ_BOTTOM => rect.right = rect.left + width_for_h,
                WMSZ_LEFT | WMSZ_RIGHT => rect.bottom = rect.top + height_for_w,
                WMSZ_TOPLEFT | WMSZ_TOPRIGHT => rect.top = rect.bottom - height_for_w,
                WMSZ_BOTTOMLEFT | WMSZ_BOTTOMRIGHT => rect.bottom = rect.top + height_for_w,
                _ => {}
            }
        }
        return LRESULT(1);
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}
