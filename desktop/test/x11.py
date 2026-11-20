#!/usr/bin/env python3
# What a user does to a window, done to the packaged app on xvfb's X server, for the tests that start
# it the way GNOME does (desktop/test/gnome.ts). The package cannot be driven by Playwright (its fuses
# switch the inspector off), so this talks to X directly through libX11 and libXtst with ctypes:
#
#   x11.py windows <pid>     the top-level windows of a process, one JSON object per line
#   x11.py close <window>    asks the window to close, as the close button of a window manager does
#   x11.py key <window> ctrl+q   gives the window the keyboard focus and presses the keys (XTest)
#
# It refuses to run unless DISPLAY is set and WAYLAND_DISPLAY is not, so it can never reach the
# user's own screen (docs/agent-regler-produksjon.md).
import ctypes
import ctypes.util
import json
import os
import sys

if os.environ.get("WAYLAND_DISPLAY") or not os.environ.get("DISPLAY") or os.environ.get("AD_DESKTOP_XVFB") != "1":
    sys.exit("x11.py kjører bare under xvfb (npm run test:desktop)")

x = ctypes.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
xtst = ctypes.CDLL(ctypes.util.find_library("Xtst") or "libXtst.so.6")

Window = ctypes.c_ulong
Atom = ctypes.c_ulong


class XWindowAttributes(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_int), ("y", ctypes.c_int), ("width", ctypes.c_int), ("height", ctypes.c_int),
        ("border_width", ctypes.c_int), ("depth", ctypes.c_int), ("visual", ctypes.c_void_p), ("root", Window),
        ("class_", ctypes.c_int), ("bit_gravity", ctypes.c_int), ("win_gravity", ctypes.c_int), ("backing_store", ctypes.c_int),
        ("backing_planes", ctypes.c_ulong), ("backing_pixel", ctypes.c_ulong), ("save_under", ctypes.c_int),
        ("colormap", ctypes.c_ulong), ("map_installed", ctypes.c_int), ("map_state", ctypes.c_int),
        ("all_event_masks", ctypes.c_long), ("your_event_mask", ctypes.c_long), ("do_not_propagate_mask", ctypes.c_long),
        ("override_redirect", ctypes.c_int), ("screen", ctypes.c_void_p),
    ]


class XClientMessageEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int), ("serial", ctypes.c_ulong), ("send_event", ctypes.c_int), ("display", ctypes.c_void_p),
        ("window", Window), ("message_type", Atom), ("format", ctypes.c_int), ("data", ctypes.c_long * 5),
    ]


class XEvent(ctypes.Union):
    _fields_ = [("xclient", XClientMessageEvent), ("pad", ctypes.c_long * 24)]


x.XOpenDisplay.restype = ctypes.c_void_p
x.XOpenDisplay.argtypes = [ctypes.c_char_p]
x.XDefaultRootWindow.restype = Window
x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x.XInternAtom.restype = Atom
x.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
x.XQueryTree.argtypes = [ctypes.c_void_p, Window, ctypes.POINTER(Window), ctypes.POINTER(Window), ctypes.POINTER(ctypes.POINTER(Window)), ctypes.POINTER(ctypes.c_uint)]
x.XGetWindowAttributes.argtypes = [ctypes.c_void_p, Window, ctypes.POINTER(XWindowAttributes)]
x.XGetWindowProperty.argtypes = [ctypes.c_void_p, Window, Atom, ctypes.c_long, ctypes.c_long, ctypes.c_int, Atom, ctypes.POINTER(Atom), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_void_p)]
x.XFree.argtypes = [ctypes.c_void_p]
x.XSendEvent.argtypes = [ctypes.c_void_p, Window, ctypes.c_int, ctypes.c_long, ctypes.POINTER(XEvent)]
x.XSetInputFocus.argtypes = [ctypes.c_void_p, Window, ctypes.c_int, ctypes.c_ulong]
x.XRaiseWindow.argtypes = [ctypes.c_void_p, Window]
x.XKeysymToKeycode.restype = ctypes.c_ubyte
x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x.XStringToKeysym.restype = ctypes.c_ulong
x.XStringToKeysym.argtypes = [ctypes.c_char_p]
x.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
x.XCloseDisplay.argtypes = [ctypes.c_void_p]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

display = x.XOpenDisplay(None)
if not display:
    sys.exit("fikk ikke kontakt med X-serveren")
ignore_errors = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)(lambda d, e: 0)  # a window gone in between
x.XSetErrorHandler(ignore_errors)


def prop(window, name, kind):
    actual, fmt, items, after, data = Atom(), ctypes.c_int(), ctypes.c_ulong(), ctypes.c_ulong(), ctypes.c_void_p()
    status = x.XGetWindowProperty(display, window, x.XInternAtom(display, name.encode(), 0), 0, 1024, 0, 0, ctypes.byref(actual), ctypes.byref(fmt), ctypes.byref(items), ctypes.byref(after), ctypes.byref(data))
    if status != 0 or not data.value:
        return None
    try:
        if kind == "cardinal" and fmt.value == 32 and items.value:
            return ctypes.cast(data, ctypes.POINTER(ctypes.c_ulong))[0]
        if kind == "string" and fmt.value == 8:
            return ctypes.string_at(data, items.value).decode("utf-8", "replace").split("\0")
        return None
    finally:
        x.XFree(data)


def toplevels():
    root_return, parent, children, count = Window(), Window(), ctypes.POINTER(Window)(), ctypes.c_uint()
    x.XQueryTree(display, x.XDefaultRootWindow(display), ctypes.byref(root_return), ctypes.byref(parent), ctypes.byref(children), ctypes.byref(count))
    out = [children[i] for i in range(count.value)]
    if children:
        x.XFree(children)
    return out


def windows(pid):
    for window in toplevels():
        if prop(window, "_NET_WM_PID", "cardinal") != pid:
            continue
        attrs = XWindowAttributes()
        x.XGetWindowAttributes(display, window, ctypes.byref(attrs))
        wm_class = prop(window, "WM_CLASS", "string") or []
        name = prop(window, "_NET_WM_NAME", "string") or prop(window, "WM_NAME", "string") or [""]
        print(json.dumps({
            "id": window,
            "mapped": attrs.map_state == 2,  # IsViewable
            "overrideRedirect": bool(attrs.override_redirect),
            "width": attrs.width,
            "height": attrs.height,
            "class": wm_class[1] if len(wm_class) > 1 else "",
            "name": name[0],
        }))


def close(window):
    event = XEvent()
    event.xclient.type = 33  # ClientMessage
    event.xclient.window = window
    event.xclient.message_type = x.XInternAtom(display, b"WM_PROTOCOLS", 0)
    event.xclient.format = 32
    event.xclient.data[0] = x.XInternAtom(display, b"WM_DELETE_WINDOW", 0)
    event.xclient.data[1] = 0  # CurrentTime
    x.XSendEvent(display, window, 0, 0, ctypes.byref(event))
    x.XSync(display, 0)


def key(window, combo):
    names = {"ctrl": "Control_L", "shift": "Shift_L", "alt": "Alt_L"}
    codes = [x.XKeysymToKeycode(display, x.XStringToKeysym(names.get(part, part).encode())) for part in combo.split("+")]
    x.XRaiseWindow(display, window)
    x.XSetInputFocus(display, window, 2, 0)  # RevertToParent, CurrentTime
    x.XSync(display, 0)
    for code in codes:
        xtst.XTestFakeKeyEvent(display, code, 1, 0)
    for code in reversed(codes):
        xtst.XTestFakeKeyEvent(display, code, 0, 0)
    x.XSync(display, 0)


command = sys.argv[1] if len(sys.argv) > 1 else ""
if command == "windows":
    windows(int(sys.argv[2]))
elif command == "close":
    close(int(sys.argv[2]))
elif command == "key":
    key(int(sys.argv[2]), sys.argv[3])
else:
    sys.exit(__doc__ or "x11.py windows|close|key")
x.XCloseDisplay(display)
