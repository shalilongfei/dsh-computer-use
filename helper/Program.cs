using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Collections.Generic;
using System.Linq;
using System.Windows.Forms;
using System.Windows.Automation;

public class Win32Bridge
{
    [DllImport("user32.dll")] static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")] static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X; public int Y; }

    // === Modern input injection (SendInput) ===
    // mouse_event/keybd_event are deprecated and are silently ignored in several
    // hardened/remote environments; SendInput is attempted first, with the legacy
    // path kept as a fallback.
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)] static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, StringBuilder pvInfo, uint nLength, out uint lpnLengthNeeded);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT
    {
        public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT
    {
        public uint type; public INPUTUNION u;
    }

    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;
    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
    const uint GA_ROOT = 2;
    const int UOI_NAME = 2;

    /// <summary>提权 broker 监听的端口（与 start-broker.ps1、插件保持一致）。</summary>
    const int BrokerPort = 45919;

    // === MSAA (oleacc) ===
    // 部分环境里 UIA 只能拿到降级的 MSAA 桥（控件退化成 Pane、没有 InvokePattern），
    // 此时直接问 MSAA 要默认动作往往还能成功。
    [DllImport("oleacc.dll")]
    static extern int AccessibleObjectFromPoint(POINT pt, [MarshalAs(UnmanagedType.Interface)] out object ppacc, out object pvarChild);

    [ComImport, Guid("618736e0-3c3d-11cf-810c-00aa00389b71"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    interface IAccessible
    {
        [DispId(-5000)] void set_accParent([MarshalAs(UnmanagedType.IDispatch)] object v);
        [DispId(-5000)] [return: MarshalAs(UnmanagedType.IDispatch)] object get_accParent();
        [DispId(-5001)] int get_accChildCount();
        [DispId(-5002)] [return: MarshalAs(UnmanagedType.IDispatch)] object get_accChild(object childID);
        [DispId(-5003)] [return: MarshalAs(UnmanagedType.BStr)] string get_accName(object childID);
        [DispId(-5004)] [return: MarshalAs(UnmanagedType.BStr)] string get_accValue(object childID);
        [DispId(-5005)] [return: MarshalAs(UnmanagedType.BStr)] string get_accDescription(object childID);
        [DispId(-5006)] object get_accRole(object childID);
        [DispId(-5007)] object get_accState(object childID);
        [DispId(-5008)] [return: MarshalAs(UnmanagedType.BStr)] string get_accHelp(object childID);
        [DispId(-5009)] int get_accHelpTopic(out string topic, object childID);
        [DispId(-5010)] [return: MarshalAs(UnmanagedType.BStr)] string get_accKeyboardShortcut(object childID);
        [DispId(-5011)] object get_accFocus();
        [DispId(-5012)] object get_accSelection();
        [DispId(-5013)] [return: MarshalAs(UnmanagedType.BStr)] string get_accDefaultAction(object childID);
        [DispId(-5014)] void accSelect(int flagsSelect, object childID);
        [DispId(-5015)] void accLocation(out int pxLeft, out int pyTop, out int pcxWidth, out int pcyHeight, object childID);
        [DispId(-5016)] object accNavigate(int navDir, object childID);
        [DispId(-5017)] object accHitTest(int xLeft, int yTop);
        [DispId(-5018)] void accDoDefaultAction(object childID);
        [DispId(-5000)] void set_accName(object childID, string v);
        [DispId(-5004)] void set_accValue(object childID, string v);
    }

    /// <summary>用 MSAA 在指定点执行默认动作（等价于大多数控件的"单击"）。</summary>
    static string TryMsaaDefaultActionAt(POINT pt)
    {
        try
        {
            object accObj, child;
            int hr = AccessibleObjectFromPoint(pt, out accObj, out child);
            if (hr != 0 || accObj == null)
            {
                DebugNote += " msaa-hr=" + hr;
                return null;
            }
            var acc = accObj as IAccessible;
            if (acc == null) { DebugNote += " msaa-no-interface"; return null; }

            string name = "";
            try { name = acc.get_accName(child); } catch { }
            string defAction = "";
            try { defAction = acc.get_accDefaultAction(child); } catch { }
            if (string.IsNullOrEmpty(defAction))
            {
                // 没有默认动作时退到父级（例如命中在内部的静态文本上）
                try
                {
                    var parent = acc.get_accParent() as IAccessible;
                    if (parent != null)
                    {
                        string pAction = parent.get_accDefaultAction(0);
                        if (!string.IsNullOrEmpty(pAction))
                        {
                            parent.accDoDefaultAction(0);
                            return JsonSerializer.Serialize(new { success = true, data = new { x = pt.X, y = pt.Y, deliveredVia = "msaa-parent-default-action", element = name, action = pAction } });
                        }
                    }
                }
                catch { }
                DebugNote += " msaa-no-default-action(element='" + name + "')";
                return null;
            }
            acc.accDoDefaultAction(child);
            return JsonSerializer.Serialize(new { success = true, data = new { x = pt.X, y = pt.Y, deliveredVia = "msaa-default-action", element = name, action = defAction, note = "synthetic input is blocked in this session; activated through MSAA" } });
        }
        catch (Exception ex)
        {
            DebugNote += " msaa-exception=" + ex.Message;
            return null;
        }
    }

    /// <summary>最近一次 UIA 兜底尝试的说明，便于诊断为什么没命中。</summary>
    static string DebugNote = "";

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    const uint MOUSEEVENTF_LEFTUP = 0x04;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x08;
    const uint MOUSEEVENTF_RIGHTUP = 0x10;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x20;
    const uint MOUSEEVENTF_MIDDLEUP = 0x40;
    const uint MOUSEEVENTF_WHEEL = 0x0800;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const int SW_HIDE = 0, SW_SHOWNORMAL = 1, SW_SHOWMINIMIZED = 2, SW_SHOWMAXIMIZED = 3, SW_RESTORE = 9, SW_MINIMIZE = 6;
    const uint WM_CLOSE = 0x0010;

    static readonly Dictionary<string, byte> VK = new Dictionary<string, byte>(StringComparer.OrdinalIgnoreCase)
    {
        ["return"] = 0x0D, ["tab"] = 0x09, ["escape"] = 0x1B, ["esc"] = 0x1B,
        ["backspace"] = 0x08, ["back"] = 0x08, ["delete"] = 0x2E, ["del"] = 0x2E,
        ["left"] = 0x25, ["up"] = 0x26, ["right"] = 0x27, ["down"] = 0x28,
        ["home"] = 0x24, ["end"] = 0x23, ["pageup"] = 0x21, ["pagedown"] = 0x22,
        ["shift"] = 0x10, ["ctrl"] = 0x11, ["control"] = 0x11, ["alt"] = 0x12,
        ["lwin"] = 0x5B, ["rwin"] = 0x5C, ["win"] = 0x5B, ["super"] = 0x5B,
        ["f1"] = 0x70, ["f2"] = 0x71, ["f3"] = 0x72, ["f4"] = 0x73,
        ["f5"] = 0x74, ["f6"] = 0x75, ["f7"] = 0x76, ["f8"] = 0x77,
        ["f9"] = 0x78, ["f10"] = 0x79, ["f11"] = 0x7A, ["f12"] = 0x7B,
        ["insert"] = 0x2D, ["space"] = 0x20,
    };

    static byte? GetVkCode(string key)
    {
        if (VK.TryGetValue(key, out byte vk)) return vk;
        if (key.Length == 1)
        {
            char c = char.ToUpper(key[0]);
            if (c >= 'A' && c <= 'Z') return (byte)c;
            if (c >= '0' && c <= '9') return (byte)c;
        }
        return null;
    }

    static string Screenshot()
    {
        var screen = Screen.PrimaryScreen.Bounds;
        using var bmp = new Bitmap(screen.Width, screen.Height);
        using var g = Graphics.FromImage(bmp);
        g.CopyFromScreen(screen.Location, Point.Empty, screen.Size);

        int maxWidth = 1366;
        double scale = screen.Width > maxWidth ? (double)maxWidth / screen.Width : 1.0;
        int newW = (int)(screen.Width * scale);
        int newH = (int)(screen.Height * scale);

        using var scaled = new Bitmap(newW, newH);
        using var sg = Graphics.FromImage(scaled);
        sg.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
        sg.DrawImage(bmp, 0, 0, newW, newH);

        using var ms = new MemoryStream();
        var jpeg = ImageCodecInfo.GetImageEncoders().First(e => e.MimeType == "image/jpeg");
        var ep = new EncoderParameters(1);
        ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 70L);
        scaled.Save(ms, jpeg, ep);

        return JsonSerializer.Serialize(new { success = true, data = new { image = Convert.ToBase64String(ms.ToArray()), width = newW, height = newH, origWidth = screen.Width, origHeight = screen.Height } });
    }

    // ==================== 输入注入层 ====================
    // 背景：mouse_event/keybd_event 属于废弃 API，在部分加固环境（安全软件、
    // 远程会话、受策略限制的桌面）中会被静默丢弃——调用返回成功、光标却不动，
    // 上层就会"以为点了其实没点"。这里统一走 SendInput，并在注入后回读真实
    // 状态做校验，注入失效时如实报 canInjectInput=false，而不是假装成功。

    static void ReadCursor(out int x, out int y)
    {
        POINT p;
        if (GetCursorPos(out p)) { x = p.X; y = p.Y; } else { x = -1; y = -1; }
    }

    static bool CursorIsAt(int x, int y)
    {
        int cx, cy;
        ReadCursor(out cx, out cy);
        return Math.Abs(cx - x) <= 1 && Math.Abs(cy - y) <= 1;
    }

    /// <summary>用 SendInput 做绝对移动（走虚拟桌面坐标系，支持多屏）。</summary>
    static bool TrySendInputMove(int x, int y)
    {
        int vx = GetSystemMetrics(76);            // SM_XVIRTUALSCREEN
        int vy = GetSystemMetrics(77);            // SM_YVIRTUALSCREEN
        int vw = Math.Max(1, GetSystemMetrics(78));
        int vh = Math.Max(1, GetSystemMetrics(79));
        double nx = (x - vx) * 65535.0 / Math.Max(1, vw - 1);
        double ny = (y - vy) * 65535.0 / Math.Max(1, vh - 1);
        var inputs = new INPUT[1];
        inputs[0].type = INPUT_MOUSE;
        inputs[0].u.mi.dx = (int)Math.Round(nx);
        inputs[0].u.mi.dy = (int)Math.Round(ny);
        inputs[0].u.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
        uint sent = SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        if (sent != 1) return false;
        Thread.Sleep(30);
        return CursorIsAt(x, y);
    }

    /// <summary>把光标移到目标点：SendInput → SetCursorPos 两级回退，并校验结果。</summary>
    static bool MoveCursorVerified(int x, int y)
    {
        // 关键：先记录起点。若目标点恰好就是当前位置，任何"到位"检查都会误判成功，
        // 注入被拦的机器上就会绕过 broker。所以只有"位置确实从起点变到了终点"才算成功。
        int x0, y0;
        ReadCursor(out x0, out y0);

        if (TrySendInputMove(x, y)) return true;
        if (SetCursorPos(x, y))
        {
            Thread.Sleep(30);
            if (CursorIsAt(x, y)) return true;
        }

        // 两级都无效：光标没动过（或压根没到），调用方必须知道这件事。
        int x1, y1;
        ReadCursor(out x1, out y1);
        bool actuallyMoved = Math.Abs(x1 - x0) > 1 || Math.Abs(y1 - y0) > 1;
        return actuallyMoved && CursorIsAt(x, y);
    }

    static void SendMouseButton(uint downFlag, uint upFlag, int count)
    {
        var inputs = new INPUT[2];
        inputs[0].type = INPUT_MOUSE; inputs[0].u.mi.dwFlags = downFlag;
        inputs[1].type = INPUT_MOUSE; inputs[1].u.mi.dwFlags = upFlag;
        for (int i = 0; i < count; i++)
        {
            uint sent = SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (sent != 2)
            {
                mouse_event(downFlag, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(30);
                mouse_event(upFlag, 0, 0, 0, UIntPtr.Zero);
            }
            if (i < count - 1) Thread.Sleep(100);
        }
    }

    static void SendKeyVk(ushort vk, bool up)
    {
        var inputs = new INPUT[1];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].u.ki.wVk = vk;
        inputs[0].u.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0u;
        if (SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) != 1)
        {
            keybd_event((byte)vk, 0, up ? KEYEVENTF_KEYUP : 0u, UIntPtr.Zero);
        }
    }

    static void SendKeyUnicode(char c, bool up)
    {
        var inputs = new INPUT[1];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].u.ki.wScan = c;
        inputs[0].u.ki.dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0u);
        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    static string Click(int x, int y, string button, int count)
    {
        uint down = 0, up = 0;
        switch (button)
        {
            case "left": down = MOUSEEVENTF_LEFTDOWN; up = MOUSEEVENTF_LEFTUP; break;
            case "right": down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; break;
            case "middle": down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; break;
            default: return JsonSerializer.Serialize(new { success = false, error = $"Unknown mouse button: {button}" });
        }

        POINT pt = new POINT { X = x, Y = y };
        bool moved = MoveCursorVerified(x, y);
        if (!moved)
        {
            // 光标到不了目标点，此刻绝不能"照点不误"——那会点到别的窗口上造成误操作。
            // 改为尝试 UI Automation 直接激活该坐标下的控件（不依赖注入）。
            var uia = TryUiaActivateAt(pt, button);
            if (uia != null) return uia;

            int cx, cy;
            ReadCursor(out cx, out cy);
            return JsonSerializer.Serialize(new
            {
                success = false,
                error = $"input injection unavailable: cursor stayed at ({cx},{cy}) instead of ({x},{y}); " +
                        "mouse_event/SetCursorPos are being blocked in this session, and no UI Automation " +
                        "pattern was found at that point. Use click_element / ui_elements / focus_window instead.",
                data = new { requestedX = x, requestedY = y, actualX = cx, actualY = cy, canInjectInput = false, inputBlocked = true, uiaProbe = DebugNote }
            });
        }

        Thread.Sleep(50);
        SendMouseButton(down, up, count);
        return JsonSerializer.Serialize(new { success = true, data = new { x, y, button, count, deliveredVia = "synthetic-input" } });
    }

    /// <summary>
    /// 注入不可用时的替代点击：找到该点下的控件，用 UIA 模式直接激活它。
    /// 只对 left 键并且找到可用模式时返回结果，否则返回 null 让调用方继续报错。
    /// </summary>
    static string TryUiaActivateAt(POINT pt, string button)
    {
        if (button != "left") return null;
        try
        {
            IntPtr hwnd = WindowFromPoint(pt);
            if (hwnd == IntPtr.Zero) { DebugNote = "WindowFromPoint returned 0"; return null; }
            IntPtr root = GetAncestor(hwnd, GA_ROOT);
            var window = AutomationElement.FromHandle(root != IntPtr.Zero ? root : hwnd);
            if (window == null) { DebugNote = "AutomationElement.FromHandle returned null"; return null; }
            try { DebugNote = "window='" + window.Current.Name + "'"; } catch { }

            AutomationElement target = null;

            // 命中点所在的最深控件
            var all = window.FindAll(TreeScope.Descendants, Condition.TrueCondition);
            int scanned = 0, hits = 0;
            foreach (AutomationElement el in all)
            {
                try
                {
                    scanned++;
                    var r = el.Current.BoundingRectangle;
                    if (r.Width <= 0 || r.Height <= 0) continue;
                    if (pt.X >= r.Left && pt.X <= r.Right && pt.Y >= r.Top && pt.Y <= r.Bottom)
                    {
                        target = el;   // 后出现的更深；继续找更小的
                        hits++;
                        if (r.Width < 60 && r.Height < 60) break;
                    }
                }
                catch { }
            }
            DebugNote += " scanned=" + scanned + " hits=" + hits;
            if (target == null) return null;

            string name = "";
            try { name = target.Current.Name; } catch { }
            string ctype = "";
            try { ctype = target.Current.ControlType.ProgrammaticName; } catch { }
            bool hasInvoke = false, hasSelect = false, hasToggle = false;
            try { hasInvoke = target.TryGetCurrentPattern(InvokePattern.Pattern, out _); } catch { }
            try { hasSelect = target.TryGetCurrentPattern(SelectionItemPattern.Pattern, out _); } catch { }
            try { hasToggle = target.TryGetCurrentPattern(TogglePattern.Pattern, out _); } catch { }
            DebugNote += " target='" + name + "' type=" + ctype + " invoke=" + hasInvoke + " select=" + hasSelect + " toggle=" + hasToggle;

            if (target.TryGetCurrentPattern(InvokePattern.Pattern, out object inv))
            {
                ((InvokePattern)inv).Invoke();
                return JsonSerializer.Serialize(new { success = true, data = new { x = pt.X, y = pt.Y, button, deliveredVia = "uia-invoke", element = name, note = "synthetic input is blocked in this session; activated via UI Automation" } });
            }
            if (target.TryGetCurrentPattern(SelectionItemPattern.Pattern, out object sel))
            {
                ((SelectionItemPattern)sel).Select();
                return JsonSerializer.Serialize(new { success = true, data = new { x = pt.X, y = pt.Y, button, deliveredVia = "uia-select", element = name } });
            }
            if (target.TryGetCurrentPattern(TogglePattern.Pattern, out object tog))
            {
                ((TogglePattern)tog).Toggle();
                return JsonSerializer.Serialize(new { success = true, data = new { x = pt.X, y = pt.Y, button, deliveredVia = "uia-toggle", element = name } });
            }
            // MSAA / 旧控件只暴露 LegacyIAccessiblePattern，DoDefaultAction 等价于"按下默认动作"（多数控件就是单击）。
            var msaa = TryMsaaDefaultActionAt(pt);
            if (msaa != null) return msaa;
        }
        catch (Exception ex) { DebugNote += " exception=" + ex.Message; }
        return null;
    }

    static string MouseMove(int x, int y, bool allowFallback = true)
    {
        if (MoveCursorVerified(x, y))
        {
            return JsonSerializer.Serialize(new { success = true, data = new { x, y } });
        }

        // 本进程注入被拦：改由提权 broker 完成（broker 自己换算坐标并校验落点）。
        var viaBroker = TryBrokerMove(x, y);
        if (viaBroker != null) return viaBroker;

        if (!allowFallback)
        {
            int cx, cy;
            ReadCursor(out cx, out cy);
            return JsonSerializer.Serialize(new
            {
                success = false,
                error = $"input injection unavailable: cursor stayed at ({cx},{cy}) instead of ({x},{y})",
                data = new { requestedX = x, requestedY = y, actualX = cx, actualY = cy, canInjectInput = false }
            });
        }

        // allowFallback=true: 报告真实结果，但保留"继续尝试"的语义，便于定位硬件级阻塞。
        int fx, fy;
        ReadCursor(out fx, out fy);
        return JsonSerializer.Serialize(new
        {
            success = false,
            error = $"input injection unavailable: cursor stayed at ({fx},{fy}) instead of ({x},{y}); " +
                    "mouse_event/SetCursorPos are being blocked in this session. " +
                    "Use the UI Automation actions (click_element / ui_elements / window_text / focus_window) instead.",
            data = new { requestedX = x, requestedY = y, actualX = fx, actualY = fy, canInjectInput = false }
        });
    }

    static string Drag(int fromX, int fromY, int toX, int toY)
    {
        if (!MoveCursorVerified(fromX, fromY))
        {
            int cx, cy;
            ReadCursor(out cx, out cy);
            return JsonSerializer.Serialize(new
            {
                success = false,
                error = $"input injection unavailable: cursor stayed at ({cx},{cy}) instead of ({fromX},{fromY})",
                data = new { canInjectInput = false }
            });
        }
        Thread.Sleep(100);
        SendMouseButton(MOUSEEVENTF_LEFTDOWN, 0, 1);   // 按下
        Thread.Sleep(50);
        MoveCursorVerified(toX, toY);
        Thread.Sleep(100);
        SendMouseButton(0, MOUSEEVENTF_LEFTUP, 1);    // 抬起
        return JsonSerializer.Serialize(new { success = true, data = new { fromX, fromY, toX, toY } });
    }

    static string Scroll(int amount, string direction, bool allowBroker = true)
    {
        int delta = -120 * amount;
        if (direction == "up") delta = Math.Abs(delta);
        else if (direction == "down") delta = -Math.Abs(delta);

        var inputs = new INPUT[1];
        inputs[0].type = INPUT_MOUSE;
        inputs[0].u.mi.mouseData = unchecked((uint)delta);
        inputs[0].u.mi.dwFlags = MOUSEEVENTF_WHEEL;
        uint sent = SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        if (sent != 1)
        {
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, unchecked((uint)delta), UIntPtr.Zero);
        }

        // 滚轮无法回读效果，用"键盘/鼠标注入是否被拦"作为代理判断：
        // 被拦时本地这次 SendInput 其实是被丢弃的，改由提权 broker 发滚轮。
        if (allowBroker && !InputInjectionAlive())
        {
            var viaBroker = TryBrokerScroll(amount, direction);
            if (viaBroker != null) return viaBroker;
        }

        return JsonSerializer.Serialize(new
        {
            success = true,
            data = new { amount, direction, deliveredVia = sent == 1 ? "sendinput" : "legacy" }
        });
    }

    /// <summary>
    /// 注入是否真的活着。判据必须是"光标位置真的变了"：
    /// - 不能用"移它已经所在的位置"（永远成功）
    /// - 也不能信 SetCursorPos 的返回值（本机拦截时它照样返回 True）
    /// 这里移到相邻 2 像素并确认回读值确实变了，然后把光标放回原处。
    /// </summary>
    static bool InputInjectionAlive()
    {
        int x, y;
        ReadCursor(out x, out y);
        if (x < 0 || y < 0) return true;

        int sw = Math.Max(1, GetSystemMetrics(0));
        int tx = x + 2;
        if (tx > sw - 2) tx = x - 2;
        if (tx < 0 || tx == x) return true;

        if (!MoveCursorVerified(tx, y)) return false;
        int ax, ay;
        ReadCursor(out ax, out ay);
        bool changed = Math.Abs(ax - x) > 1 || Math.Abs(ay - y) > 1;

        if (changed) SetCursorPos(x, y);   // 放回原处，尽量不打扰用户
        return changed;
    }

    /// <summary>把滚轮委托给提权 broker。</summary>
    static string TryBrokerScroll(int amount, string direction)
    {
        try
        {
            string request = JsonSerializer.Serialize(new { action = "scroll", amount, direction });
            string response = SendBrokerLine(request, 15000);
            if (string.IsNullOrEmpty(response)) return null;
            using var doc = JsonDocument.Parse(response);
            var root = doc.RootElement;
            if (!root.TryGetProperty("success", out var okEl) || okEl.ValueKind != JsonValueKind.True) return null;

            return JsonSerializer.Serialize(new
            {
                success = true,
                data = new
                {
                    amount, direction,
                    deliveredVia = "elevated-broker",
                    note = "local injection is blocked in this session; the wheel event was sent by the elevated broker"
                }
            });
        }
        catch { return null; }
    }

    /// <summary>
    /// 往"当前焦点元素"写文本。合成键盘输入被拦截时，退化为 UIA ValuePattern，
    /// 这样即便注入不可用，也还能可靠地填输入框。
    /// </summary>
    static bool TryTypeViaUia(string text)
    {
        try
        {
            var focused = AutomationElement.FocusedElement;
            if (focused == null) return false;
            if (!focused.TryGetCurrentPattern(ValuePattern.Pattern, out object vp)) return false;
            ((ValuePattern)vp).SetValue(text);
            return true;
        }
        catch { return false; }
    }

    static string Type(string text, bool preferNativeInput = false)
    {
        // 默认优先 UIA：在注入被拦截的机器上这是唯一可靠的通路；
        // preferNativeInput=true 时强制走真实键盘事件（需要触发按键回调的场景）。
        if (!preferNativeInput && TryTypeViaUia(text))
        {
            return JsonSerializer.Serialize(new { success = true, data = new { length = text.Length, deliveredVia = "uia-value-pattern" } });
        }

        // 真实键盘事件：SendInput 的 KEYEVENTF_UNICODE 可直接输入任意 Unicode 字符，
        // 不再需要"写剪贴板 + Ctrl+V"那种会破坏用户剪贴板的做法。
        int sentCount = 0;
        foreach (char c in text)
        {
            SendKeyUnicode(c, false);
            SendKeyUnicode(c, true);
            sentCount++;
            Thread.Sleep(10);
        }

        // 本进程注入被拦时改由提权 broker 发键（否则上面的调用是"假成功"）。
        if (!LastKeyInputLanded())
        {
            var viaBroker = TryBrokerType(text);
            if (viaBroker != null) return viaBroker;
        }

        return JsonSerializer.Serialize(new { success = true, data = new { length = sentCount, deliveredVia = "sendinput-unicode" } });
    }

    /// <summary>
    /// 键盘注入是否真的生效：用一个"不动光标"的侧信道判断——注入前后读一次
    /// GetLastInputInfo 的时间戳，被拦截时它不会推进。
    /// </summary>
    static bool LastKeyInputLanded()
    {
        try
        {
            var a = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
            if (!GetLastInputInfo(ref a)) return true;   // 拿不到就按"没被拦"处理，交给真实动作报错
            Thread.Sleep(40);
            var b = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
            if (!GetLastInputInfo(ref b)) return true;
            return b.dwTime != a.dwTime || Environment.TickCount - (int)b.dwTime < 500;
        }
        catch { return true; }
    }

    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    /// <summary>把键盘输入委托给提权 broker（它才真的能注入）。</summary>
    static string TryBrokerType(string text)
    {
        try
        {
            string request = JsonSerializer.Serialize(new { action = "type", text, preferNativeInput = true });
            string response = SendBrokerLine(request, 60000);
            if (string.IsNullOrEmpty(response)) return null;

            using var doc = JsonDocument.Parse(response);
            var root = doc.RootElement;
            if (!root.TryGetProperty("success", out var okEl) || okEl.ValueKind != JsonValueKind.True) return null;
            var data = root.GetProperty("data");
            string via = data.TryGetProperty("deliveredVia", out var vEl) ? vEl.GetString() : "";

            return JsonSerializer.Serialize(new
            {
                success = true,
                data = new
                {
                    length = text.Length,
                    deliveredVia = "elevated-broker:" + via,
                    note = "local keyboard injection is blocked in this session; keystrokes were sent by the elevated broker"
                }
            });
        }
        catch { return null; }
    }

    // ==================== DPI 感知与坐标换算 ====================
    // UI Automation 的 BoundingRectangle 与鼠标注入的坐标系在不同 DPI 感知级别下
    // 不一致（本机实测：UIA 给物理像素，WinForms/逻辑给逻辑像素）。凡是把 UIA
    // 坐标交给 SetCursorPos/SendInput 的地方，都必须先统一坐标系。

    [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")] static extern uint GetAwarenessFromDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("shcore.dll")] static extern int GetProcessDpiAwareness(IntPtr hProcess, out int awareness);

    [StructLayout(LayoutKind.Sequential)]
    struct RECTL { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool LogicalToPhysicalPointForPerMonitorDPI(IntPtr hwnd, ref POINT lpPoint);

    [DllImport("gdi32.dll")] static extern int GetDeviceCaps(IntPtr hdc, int index);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    const int LOGPIXELSX = 88;

    /// <summary>把 UIA 元素的逻辑坐标换算成物理屏幕坐标（注入 API 使用的坐标系）。</summary>
    static POINT LogicalToPhysical(System.Windows.Rect rect, IntPtr hwnd)
    {
        double cx = rect.X + rect.Width / 2.0;
        double cy = rect.Y + rect.Height / 2.0;

        // 先试系统自带的换算入口（PerMonitorV2 进程下最准）。
        try
        {
            var probe = new POINT { X = (int)Math.Round(cx), Y = (int)Math.Round(cy) };
            if (LogicalToPhysicalPointForPerMonitorDPI(hwnd, ref probe) && probe.X != 0 && probe.Y != 0)
            {
                return probe;
            }
        }
        catch { }

        // 退化路径：按窗口 DPI 比例换算。
        double scale = 1.0;
        try
        {
            uint dpi = hwnd != IntPtr.Zero ? GetDpiForWindow(hwnd) : 0;
            if (dpi == 0)
            {
                IntPtr hdc = GetDC(IntPtr.Zero);
                if (hdc != IntPtr.Zero)
                {
                    dpi = (uint)GetDeviceCaps(hdc, LOGPIXELSX);
                    ReleaseDC(IntPtr.Zero, hdc);
                }
            }
            if (dpi > 0) scale = dpi / 96.0;
        }
        catch { }

        // 若本进程本身就是 DPI 感知的，UIA 值已经是物理像素，别再乘一次。
        bool alreadyPhysical = true;
        try { alreadyPhysical = GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()) >= 2; }
        catch { alreadyPhysical = true; }

        if (alreadyPhysical || Math.Abs(scale - 1.0) < 0.01)
        {
            return new POINT { X = (int)Math.Round(cx), Y = (int)Math.Round(cy) };
        }
        return new POINT { X = (int)Math.Round(cx * scale), Y = (int)Math.Round(cy * scale) };
    }

    static string DpiInfo()
    {
        uint threadAwareness = 0;
        int processAwareness = -1;
        try { threadAwareness = GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()); } catch { }
        try { GetProcessDpiAwareness(System.Diagnostics.Process.GetCurrentProcess().Handle, out processAwareness); } catch { }
        int dpi = 96;
        try
        {
            IntPtr hdc = GetDC(IntPtr.Zero);
            if (hdc != IntPtr.Zero) { dpi = GetDeviceCaps(hdc, LOGPIXELSX); ReleaseDC(IntPtr.Zero, hdc); }
        }
        catch { }
        return JsonSerializer.Serialize(new { threadAwareness, processAwareness, systemDpi = dpi, scale = dpi / 96.0 });
    }


    static string DesktopName(IntPtr hDesktop)
    {
        try
        {
            var sb = new StringBuilder(256);
            uint needed;
            if (GetUserObjectInformation(hDesktop, UOI_NAME, sb, 256, out needed)) return sb.ToString();
        }
        catch { }
        return "unknown";
    }

    // ==================== 常驻提权代理（broker） ====================
    // 背景：DSH 以中完整性运行，它的整个进程树都被安全软件挡在"合成输入"之外；
    // 只有以管理员身份、在交互式会话里启动的进程才能注入。于是提供一个常驻 broker：
    // 由用户显式提权启动一次，监听回环端口，插件把鼠标/键盘动作转发过来执行。
    //
    // 安全：broker 拥有管理员权限且能注入输入，因此所有请求都必须带令牌。
    // 令牌首次运行时生成，存放在 exe 同级目录的 broker.token（仅当前用户可读），
    // 客户端（插件）和 broker 读同一份文件。没有令牌的请求一律拒绝。

    const string BrokerTokenFile = "broker.token";

    static string BrokerTokenPath()
    {
        try
        {
            string dir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            if (string.IsNullOrEmpty(dir)) dir = ".";
            return Path.Combine(dir, BrokerTokenFile);
        }
        catch { return BrokerTokenFile; }
    }

    /// <summary>
    /// 读取已有令牌；不存在或内容过短才生成新的。
    /// 注意：**绝不能在 broker 运行期间重新生成令牌** —— broker 把令牌缓存在内存里，
    /// 而客户端每次从文件读，一旦文件被换掉，两边就永远对不上，只能重启 broker 才能恢复。
    /// 所以这里只做"缺失时补建"。
    /// </summary>
    static string EnsureBrokerToken()
    {
        string path = BrokerTokenPath();
        try
        {
            if (File.Exists(path))
            {
                string existing = File.ReadAllText(path).Trim();
                if (existing.Length >= 32) return existing;
            }
            var bytes = new byte[32];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            string token = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
            File.WriteAllText(path, token, new UTF8Encoding(false));
            return token;
        }
        catch { return null; }
    }

    static string RunBroker(int port, bool printToken)
    {
        string token = EnsureBrokerToken();
        if (token == null)
        {
            return JsonSerializer.Serialize(new { success = false, error = "cannot create/read the broker token file next to the executable" });
        }

        var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, port);
        try { listener.Start(); }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { success = false, error = "cannot listen on 127.0.0.1:" + port + " - " + ex.Message });
        }

        Console.Out.WriteLine(JsonSerializer.Serialize(new
        {
            success = true,
            data = new
            {
                listening = "127.0.0.1:" + port,
                processId = GetCurrentProcessId(),
                tokenFile = BrokerTokenPath(),
                authRequired = true,
                note = "elevated computer-use broker; every request must carry the token from tokenFile"
            }
        }));
        Console.Out.Flush();

        bool live = MoveCursorVerified(0, 0) || CursorIsAt(0, 0);
        while (true)
        {
            using var client = listener.AcceptTcpClient();
            client.ReceiveTimeout = 60000;
            client.SendTimeout = 60000;
            using var stream = client.GetStream();
            using var reader = new StreamReader(stream, new UTF8Encoding(false));
            using var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
            string line;
            while ((line = reader.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                string response;
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    var root = doc.RootElement;

                    // 鉴权：必须是同一个用户目录下的令牌
                    string presented = root.TryGetProperty("token", out var tkEl) ? tkEl.GetString() : null;
                    if (!string.Equals(presented, token, StringComparison.Ordinal))
                    {
                        writer.WriteLine(JsonSerializer.Serialize(new { success = false, error = "unauthorized: missing or invalid broker token" }));
                        continue;
                    }

                    string action = root.TryGetProperty("action", out var aEl) ? aEl.GetString() : "";
                    response = action switch
                    {
                        "ping" => JsonSerializer.Serialize(new { success = true, data = new { role = "broker", processId = GetCurrentProcessId(), canInjectInput = live } }),
                        "mouse_move" => MouseMove(root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32()),
                        "click" => BrokerClick(root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32(),
                            root.TryGetProperty("button", out var b2) ? b2.GetString() : "left",
                            root.TryGetProperty("count", out var c2) ? c2.GetInt32() : 1),
                        "click_uia" => BrokerClickUia(
                            root.GetProperty("uiaX").GetInt32(),
                            root.GetProperty("uiaY").GetInt32(),
                            root.TryGetProperty("rgb", out var rgbEl) ? rgbEl.GetString() : ""),
                        "pixel_at" => JsonSerializer.Serialize(new { success = true, data = new { x = root.GetProperty("x").GetInt32(), y = root.GetProperty("y").GetInt32(), rgb = PixelAt(root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32()) } }),
                        "metrics" => BrokerMetrics(),
                        "broker_mapping" => BrokerMapping(),
                        "broker_move" => BrokerMove(root.GetProperty("uiaX").GetInt32(), root.GetProperty("uiaY").GetInt32()),
                        "pixel_uia" => BrokerPixelUia(root.GetProperty("uiaX").GetInt32(), root.GetProperty("uiaY").GetInt32()),
                        "move_check" => JsonSerializer.Serialize(new
                        {
                            success = true,
                            data = new
                            {
                                requested = new[] { root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32() },
                                before = ReadCursorPair(),
                                moveResult = MoveCursorVerified(root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32()),
                                after = ReadCursorPair(),
                                setCursorPosReturn = SetCursorPos(root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32()),
                                afterSetPos = ReadCursorPair(),
                                metrics = new { screen = new[] { GetSystemMetrics(0), GetSystemMetrics(1) }, virtualScreen = new[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) } },
                            }
                        }),
                        "drag" => Drag(root.GetProperty("fromX").GetInt32(), root.GetProperty("fromY").GetInt32(),
                            root.GetProperty("toX").GetInt32(), root.GetProperty("toY").GetInt32()),
                        "scroll" => Scroll(root.TryGetProperty("amount", out var a3) ? a3.GetInt32() : 3,
                            root.TryGetProperty("direction", out var d3) ? d3.GetString() : "down", false),
                        "type" => Type(root.GetProperty("text").GetString(),
                            root.TryGetProperty("preferNativeInput", out var p3) && p3.GetBoolean()),
                        "key" => Key(root.GetProperty("key").GetString(),
                            root.TryGetProperty("modifiers", out var m3) ? m3.EnumerateArray().Select(m => m.GetString()).ToArray() : Array.Empty<string>()),
                        "cursor_position" => CursorPosition(),
                        "cursor_info" => CursorInfo(),
                        "diagnose" => Diagnose(!root.TryGetProperty("liveTest", out var lt3) || lt3.GetBoolean()),
                        "ui_elements" => GetUiElements(
                            root.TryGetProperty("title", out var t3) ? t3.GetString() : null,
                            root.TryGetProperty("includeText", out var it3) && it3.GetBoolean()),
                        "click_element" => ClickElement(
                            root.TryGetProperty("title", out var ct3) ? ct3.GetString() : null,
                            root.GetProperty("target").GetString(), 0, 0),
                        "clipboard" => ClipboardAction(
                            root.TryGetProperty("operation", out var op3) ? op3.GetString() : "read",
                            root.TryGetProperty("text", out var tx3) ? tx3.GetString() : null),
                        "quit" => "__QUIT__",
                        _ => JsonSerializer.Serialize(new { success = false, error = "broker: unknown action " + action })
                    };
                }
                catch (Exception ex)
                {
                    response = JsonSerializer.Serialize(new { success = false, error = "broker: " + ex.Message });
                }
                if (response == "__QUIT__")
                {
                    writer.WriteLine(JsonSerializer.Serialize(new { success = true, data = new { stopping = true } }));
                    listener.Stop();
                    return JsonSerializer.Serialize(new { success = true, data = new { stopped = true } });
                }
                writer.WriteLine(response);
            }
        }
    }

    /// <summary>broker 专用的点击：执行后回报光标位置与命中窗口，便于调用方校验落点。</summary>
    static string BrokerClick(int x, int y, string button, int count)
    {
        IntPtr before = WindowFromPoint(new POINT { X = x, Y = y });
        string titleBefore = "";
        try { var sb = new StringBuilder(256); GetWindowText(GetAncestor(before, GA_ROOT), sb, 256); titleBefore = sb.ToString(); } catch { }

        string clickResult = Click(x, y, button, count);

        int cx, cy;
        ReadCursor(out cx, out cy);
        IntPtr after = WindowFromPoint(new POINT { X = cx, Y = cy });
        string titleAfter = "";
        try { var sb = new StringBuilder(256); GetWindowText(GetAncestor(after, GA_ROOT), sb, 256); titleAfter = sb.ToString(); } catch { }

        return JsonSerializer.Serialize(new
        {
            success = true,
            data = new
            {
                x, y, button, count,
                cursorAfter = new[] { cx, cy },
                targetHwnd = before.ToInt64(),
                targetTitle = titleBefore,
                windowUnderCursor = titleAfter,
                landedOnTarget = before != IntPtr.Zero && after == before,
                clickResult,
            }
        });
    }

    /// <summary>
    /// 把一次"按 UIA 坐标的点击"委托给提权 broker。坐标换算（UIA 物理像素 → 指针逻辑
    /// 坐标）由 broker 用自己上报的尺寸完成，helper 只负责搬运原始 UIA 坐标。
    /// broker 不在线、移不到位置或落点像素不符时返回 null，调用方继续报错。
    /// </summary>
    static string TryBrokerClick(int x, int y, string button, int count)
    {
        try
        {
            string request = JsonSerializer.Serialize(new { action = "click_uia", uiaX = x, uiaY = y, rgb = "" });
            string response = SendBrokerLine(request, 15000);
            if (string.IsNullOrEmpty(response)) return null;

            using var doc = JsonDocument.Parse(response);
            var root = doc.RootElement;
            if (!root.TryGetProperty("success", out var okEl) || okEl.ValueKind != JsonValueKind.True) return null;
            var data = root.GetProperty("data");

            string pixelCheck = data.TryGetProperty("pixelCheck", out var pcEl) ? pcEl.GetString() : "";
            if (pixelCheck == "mismatch") return null;   // 落点像素对不上：不假装成功

            string windowUnder = data.TryGetProperty("windowUnderCursor", out var wuEl) ? wuEl.GetString() : "";
            string pointer = "";
            if (data.TryGetProperty("pointer", out var ptrEl) && ptrEl.ValueKind == JsonValueKind.Array)
            {
                pointer = string.Join(",", ptrEl.EnumerateArray().Select(v => v.GetInt32()));
            }

            return JsonSerializer.Serialize(new
            {
                success = true,
                data = new
                {
                    requestedUia = new[] { x, y },
                    button, count, pointer,
                    deliveredVia = "elevated-broker",
                    pixelCheck,
                    windowUnderCursor = windowUnder,
                    note = "local injection is blocked in this session; the click was routed through the elevated broker (which converted the UIA coordinates itself)"
                }
            });
        }
        catch { return null; }
    }

    /// <summary>broker 内部：把 UIA 物理坐标换算成指针逻辑坐标。</summary>
    static void MapUiaToPointer(ref int x, ref int y)
    {
        int lw = GetSystemMetrics(0), lh = GetSystemMetrics(1);
        int pw = 0, ph = 0;
        try
        {
            IntPtr dc = GetDC(IntPtr.Zero);
            if (dc != IntPtr.Zero) { pw = GetDeviceCaps(dc, 118); ph = GetDeviceCaps(dc, 117); ReleaseDC(IntPtr.Zero, dc); }
        }
        catch { }
        if (pw > 0 && ph > 0 && lw > 0 && lh > 0 && (pw != lw || ph != lh))
        {
            x = (int)Math.Round(x * (double)lw / pw);
            y = (int)Math.Round(y * (double)lh / ph);
        }
    }

    /// <summary>broker 内部：按 UIA 物理坐标移动光标并校验。</summary>
    static string BrokerMove(int uiaX, int uiaY)
    {
        int px = uiaX, py = uiaY;
        MapUiaToPointer(ref px, ref py);
        bool moved = MoveCursorVerified(px, py);
        int ax, ay;
        ReadCursor(out ax, out ay);
        IntPtr hit = WindowFromPoint(new POINT { X = ax, Y = ay });
        string title = "";
        try { var sb = new StringBuilder(256); GetWindowText(GetAncestor(hit, GA_ROOT), sb, 256); title = sb.ToString(); } catch { }
        return JsonSerializer.Serialize(new
        {
            success = moved,
            error = moved ? null : $"broker could not move the cursor to ({px},{py})",
            data = new { uia = new[] { uiaX, uiaY }, pointer = new[] { px, py }, cursorAfter = new[] { ax, ay }, windowUnderCursor = title }
        });
    }

    /// <summary>把一次"移动光标"委托给提权 broker；不在线或没到位时返回 null。</summary>
    static string TryBrokerMove(int x, int y)
    {
        try
        {
            // 这里的 x,y 是调用方给的指针逻辑坐标（与本地 API 同一坐标系），
            // 换算成 UIA 物理坐标交给 broker，由 broker 负责最终还原。
            int ux = x, uy = y;
            int lw = GetSystemMetrics(0), lh = GetSystemMetrics(1);
            int pw = 0, ph = 0;
            try
            {
                IntPtr dc = GetDC(IntPtr.Zero);
                if (dc != IntPtr.Zero) { pw = GetDeviceCaps(dc, 118); ph = GetDeviceCaps(dc, 117); ReleaseDC(IntPtr.Zero, dc); }
            }
            catch { }
            if (pw > 0 && ph > 0 && lw > 0 && lh > 0 && (pw != lw || ph != lh))
            {
                ux = (int)Math.Round(x * (double)pw / lw);
                uy = (int)Math.Round(y * (double)ph / lh);
            }

            string request = JsonSerializer.Serialize(new { action = "broker_move", uiaX = ux, uiaY = uy });
            string response = SendBrokerLine(request, 10000);
            if (string.IsNullOrEmpty(response)) return null;

            using var doc = JsonDocument.Parse(response);
            var root = doc.RootElement;
            if (!root.TryGetProperty("success", out var okEl) || okEl.ValueKind != JsonValueKind.True) return null;
            var data = root.GetProperty("data");
            string pointer = "";
            if (data.TryGetProperty("pointer", out var ptrEl) && ptrEl.ValueKind == JsonValueKind.Array)
            {
                pointer = string.Join(",", ptrEl.EnumerateArray().Select(v => v.GetInt32()));
            }
            string windowUnder = data.TryGetProperty("windowUnderCursor", out var wuEl) ? wuEl.GetString() : "";

            return JsonSerializer.Serialize(new
            {
                success = true,
                data = new { x, y, pointer, deliveredVia = "elevated-broker", windowUnderCursor = windowUnder }
            });
        }
        catch { return null; }
    }

    /// <summary>向 broker 发一行 JSON 命令并读取一行响应（自动附带令牌）。</summary>
    static string SendBrokerLine(string json, int timeoutMs)
    {
        try
        {
            string token = EnsureBrokerToken();
            string payload = json;
            if (!string.IsNullOrEmpty(token))
            {
                // 在 JSON 对象开头插入 token 字段
                int brace = payload.IndexOf('{');
                if (brace >= 0)
                {
                    payload = payload.Insert(brace + 1, "\"token\":\"" + token + "\",");
                }
            }

            using var client = new System.Net.Sockets.TcpClient();
            var connect = client.BeginConnect(System.Net.IPAddress.Loopback, BrokerPort, null, null);
            if (!connect.AsyncWaitHandle.WaitOne(2000)) return null;
            client.EndConnect(connect);
            client.ReceiveTimeout = timeoutMs;
            client.SendTimeout = timeoutMs;
            using var stream = client.GetStream();
            using var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
            using var reader = new StreamReader(stream, new UTF8Encoding(false));
            writer.WriteLine(payload);
            return reader.ReadLine();
        }
        catch { return null; }
    }

    /// <summary>
    /// broker 专用的"按 UIA 物理坐标点击"。
    /// 实测：UIA 的 BoundingRectangle 是物理像素（2880x1800），而指针 API
    /// (SetCursorPos/GetCursorPos/WindowFromPoint) 用的是被虚拟化的逻辑空间
    /// (1646x1029)，两者相差 1.75 倍。这里按 broker 自己上报的两个尺寸做换算，
    /// 移动后校验真实光标位置，并用屏幕像素颜色确认落点，最后才点击。
    /// </summary>
    static string BrokerClickUia(int uiaX, int uiaY, string rgb)
    {
        int logicalW = GetSystemMetrics(0), logicalH = GetSystemMetrics(1);
        int physW = 0, physH = 0;
        try
        {
            IntPtr dc = GetDC(IntPtr.Zero);
            if (dc != IntPtr.Zero)
            {
                physW = GetDeviceCaps(dc, 118);
                physH = GetDeviceCaps(dc, 117);
                ReleaseDC(IntPtr.Zero, dc);
            }
        }
        catch { }

        int px = uiaX, py = uiaY;
        if (physW > 0 && physH > 0 && logicalW > 0 && logicalH > 0 && (physW != logicalW || physH != logicalH))
        {
            px = (int)Math.Round(uiaX * (double)logicalW / physW);
            py = (int)Math.Round(uiaY * (double)logicalH / physH);
        }

        bool moved = MoveCursorVerified(px, py);
        if (!moved)
        {
            int bx, by;
            ReadCursor(out bx, out by);
            return JsonSerializer.Serialize(new
            {
                success = false,
                error = $"broker could not move the cursor to ({px},{py}); it stayed at ({bx},{by})",
                data = new { uia = new[] { uiaX, uiaY }, pointer = new[] { px, py }, actual = new[] { bx, by } }
            });
        }

        Thread.Sleep(60);
        string verdict = string.IsNullOrEmpty(rgb) ? "skipped" : (PixelMatches(px, py, rgb) ? "match" : "mismatch");
        if (verdict == "mismatch")
        {
            // 没有落在预期控件上：不要乱点，如实回报让上层去试别的通道。
            return JsonSerializer.Serialize(new
            {
                success = false,
                error = $"broker landed at ({px},{py}) but the pixel there does not match the target control (expected {rgb}, got {PixelAt(px, py)})",
                data = new { uia = new[] { uiaX, uiaY }, pointer = new[] { px, py }, pixelCheck = verdict }
            });
        }

        SendMouseButton(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, 1);
        int cx, cy;
        ReadCursor(out cx, out cy);
        IntPtr hit = WindowFromPoint(new POINT { X = cx, Y = cy });
        string hitTitle = "";
        try { var sb = new StringBuilder(256); GetWindowText(GetAncestor(hit, GA_ROOT), sb, 256); hitTitle = sb.ToString(); } catch { }

        return JsonSerializer.Serialize(new
        {
            success = true,
            data = new
            {
                uia = new[] { uiaX, uiaY },
                pointer = new[] { px, py },
                cursorAfter = new[] { cx, cy },
                pixelCheck = verdict,
                windowUnderCursor = hitTitle,
            }
        });
    }

    /// <summary>取屏幕上某点的 0xRRGGBB（十六进制 BGR 顺序由 GetPixel 返回）。</summary>
    static string PixelAt(int x, int y)
    {
        try
        {
            using var bmp = new Bitmap(1, 1);
            using var g = Graphics.FromImage(bmp);
            g.CopyFromScreen(x, y, 0, 0, new Size(1, 1));
            var c = bmp.GetPixel(0, 0);
            return c.R.ToString("X2") + c.G.ToString("X2") + c.B.ToString("X2");
        }
        catch { return ""; }
    }

    static bool PixelMatches(int x, int y, string rgb)
    {
        string got = PixelAt(x, y);
        if (string.IsNullOrEmpty(got) || string.IsNullOrEmpty(rgb)) return false;
        if (string.Equals(got, rgb, StringComparison.OrdinalIgnoreCase)) return true;
        // 容忍抗锯齿/渲染差异：逐通道容差 16
        try
        {
            int gr = Convert.ToInt32(got.Substring(0, 2), 16), gg = Convert.ToInt32(got.Substring(2, 2), 16), gb = Convert.ToInt32(got.Substring(4, 2), 16);
            int r = Convert.ToInt32(rgb.Substring(0, 2), 16), g2 = Convert.ToInt32(rgb.Substring(2, 2), 16), b = Convert.ToInt32(rgb.Substring(4, 2), 16);
            return Math.Abs(gr - r) <= 16 && Math.Abs(gg - g2) <= 16 && Math.Abs(gb - b) <= 16;
        }
        catch { return false; }
    }

    static int[] ReadCursorPair()
    {
        int x, y;
        ReadCursor(out x, out y);
        return new[] { x, y };
    }

    /// <summary>诊断用：单独调一次 SetCursorPos 并回读（区分返回值与实际效果）。</summary>
    static object SetCursorPosAndRead(int x, int y)
    {
        bool ret = SetCursorPos(x, y);
        Thread.Sleep(30);
        return new { setCursorPosReturn = ret, cursor = ReadCursorPair() };
    }

    /// <summary>报告 broker 进程的坐标系：逻辑屏幕、物理桌面、DPI、指针可见范围。</summary>
    static string BrokerMetrics()
    {
        int physW = 0, physH = 0, dpi = 0;
        try
        {
            IntPtr dc = GetDC(IntPtr.Zero);
            if (dc != IntPtr.Zero)
            {
                physW = GetDeviceCaps(dc, 118);
                physH = GetDeviceCaps(dc, 117);
                dpi = GetDeviceCaps(dc, 88);
                ReleaseDC(IntPtr.Zero, dc);
            }
        }
        catch { }

        var reach = new List<object>();
        foreach (var probe in new[] { new[] { 10, 10 }, new[] { 1000, 900 }, new[] { 1600, 1000 }, new[] { 2000, 1500 }, new[] { 2800, 1750 } })
        {
            bool ok = SetCursorPos(probe[0], probe[1]);
            int ax, ay;
            ReadCursor(out ax, out ay);
            reach.Add(new { x = probe[0], y = probe[1], setOk = ok, landed = new[] { ax, ay } });
        }

        return JsonSerializer.Serialize(new
        {
            success = true,
            data = new
            {
                getSystemMetrics = new[] { GetSystemMetrics(0), GetSystemMetrics(1) },
                virtualScreen = new[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) },
                deviceCaps = new[] { physW, physH },
                dpi,
                cursorNow = ReadCursorPair(),
                reach,
            }
        });
    }

    /// <summary>UIA 物理坐标 → 指针逻辑坐标的换算参数（broker 内部使用）。</summary>
    static string BrokerMapping()
    {
        int lw = GetSystemMetrics(0), lh = GetSystemMetrics(1);
        int pw = 0, ph = 0;
        try
        {
            IntPtr dc = GetDC(IntPtr.Zero);
            if (dc != IntPtr.Zero) { pw = GetDeviceCaps(dc, 118); ph = GetDeviceCaps(dc, 117); ReleaseDC(IntPtr.Zero, dc); }
        }
        catch { }
        return JsonSerializer.Serialize(new { success = true, data = new { logical = new[] { lw, lh }, physical = new[] { pw, ph } } });
    }

    /// <summary>按 UIA 物理坐标取色（broker 侧重算坐标后取色，helper 侧做不到）。</summary>
    static string BrokerPixelUia(int uiaX, int uiaY)
    {
        int lw = GetSystemMetrics(0), lh = GetSystemMetrics(1);
        int pw = 0, ph = 0;
        try
        {
            IntPtr dc = GetDC(IntPtr.Zero);
            if (dc != IntPtr.Zero) { pw = GetDeviceCaps(dc, 118); ph = GetDeviceCaps(dc, 117); ReleaseDC(IntPtr.Zero, dc); }
        }
        catch { }
        int px = uiaX, py = uiaY;
        if (pw > 0 && ph > 0 && lw > 0 && lh > 0) { px = (int)Math.Round(uiaX * (double)lw / pw); py = (int)Math.Round(uiaY * (double)lh / ph); }
        return JsonSerializer.Serialize(new { success = true, data = new { uia = new[] { uiaX, uiaY }, pointer = new[] { px, py }, rgb = PixelAt(px, py) } });
    }

    static string Diagnose(bool liveTest)
    {
        int x, y;
        ReadCursor(out x, out y);

        var report = new Dictionary<string, object?>
        {
            ["processId"] = GetCurrentProcessId(),
            ["threadId"] = GetCurrentThreadId(),
            ["sessionId"] = System.Diagnostics.Process.GetCurrentProcess().SessionId,
            ["threadDesktop"] = DesktopName(GetThreadDesktop(GetCurrentThreadId())),
            ["inputDesktop"] = DesktopName(OpenInputDesktop(0, false, 0x0001)),
            ["screenWidth"] = GetSystemMetrics(0),
            ["screenHeight"] = GetSystemMetrics(1),
            ["virtualScreen"] = new[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) },
            ["cursor"] = new[] { x, y },
        };

        if (liveTest)
        {
            // 探测真实注入能力：移动到一个"与当前位置必定不同"的点，再回读验证。
            // 注意不能只试当前位置附近——光标恰好已在目标点时会被误判成"注入成功"。
            int sw = Math.Max(1, GetSystemMetrics(0));
            int sh = Math.Max(1, GetSystemMetrics(1));
            int targetX = x + 37; if (targetX > sw - 2) targetX = Math.Max(1, x - 37); if (targetX == x) targetX = x > 1 ? x - 1 : x + 1;
            int targetY = y + 23; if (targetY > sh - 2) targetY = Math.Max(1, y - 23); if (targetY == y) targetY = y > 1 ? y - 1 : y + 1;

            int probeX, probeY;
            ReadCursor(out probeX, out probeY);
            if (probeX == targetX && probeY == targetY) targetX = targetX > 1 ? targetX - 1 : targetX + 1;

            bool viaSendInput = TrySendInputMove(targetX, targetY);
            bool moved = CursorIsAt(targetX, targetY);
            bool viaSetCursorPos = false;
            if (!moved && SetCursorPos(targetX, targetY))
            {
                Thread.Sleep(30);
                viaSetCursorPos = CursorIsAt(targetX, targetY);
                moved = viaSetCursorPos;
            }
            int ax, ay;
            ReadCursor(out ax, out ay);
            report["liveTest"] = new
            {
                targetX, targetY, actualX = ax, actualY = ay,
                sendInputWorked = viaSendInput,
                setCursorPosWorked = viaSetCursorPos,
            };
            report["canInjectInput"] = moved;
            // 探测完把光标放回原处。
            if (moved) { SetCursorPos(x, y); }
        }
        else
        {
            report["canInjectInput"] = null; // 未做实测
        }

        try { report["dpi"] = JsonSerializer.Deserialize<object>(DpiInfo()); } catch { }
        return JsonSerializer.Serialize(new { success = true, data = report });
    }

    /// <summary>把一次按键（可带修饰键）委托给提权 broker。</summary>
    static string TryBrokerKey(string key, string[] modifiers)
    {
        try
        {
            string request = JsonSerializer.Serialize(new { action = "key", key, modifiers });
            string response = SendBrokerLine(request, 20000);
            if (string.IsNullOrEmpty(response)) return null;

            using var doc = JsonDocument.Parse(response);
            var root = doc.RootElement;
            if (!root.TryGetProperty("success", out var okEl) || okEl.ValueKind != JsonValueKind.True) return null;

            return JsonSerializer.Serialize(new
            {
                success = true,
                data = new
                {
                    key, modifiers,
                    deliveredVia = "elevated-broker",
                    note = "local keyboard injection is blocked in this session; the key was sent by the elevated broker"
                }
            });
        }
        catch { return null; }
    }

    static string Key(string key, string[] modifiers)
    {
        foreach (var mod in modifiers ?? Array.Empty<string>())
        {
            var vk = GetVkCode(mod);
            if (vk.HasValue) SendKeyVk(vk.Value, false);
        }
        Thread.Sleep(20);
        var mainVk = GetVkCode(key);
        if (mainVk.HasValue)
        {
            SendKeyVk(mainVk.Value, false);
            SendKeyVk(mainVk.Value, true);
        }
        Thread.Sleep(20);
        if (modifiers != null)
        {
            foreach (var mod in modifiers.Reverse())
            {
                var vk = GetVkCode(mod);
                if (vk.HasValue) SendKeyVk(vk.Value, true);
            }
        }

        // 本进程注入被拦时改由提权 broker 发键，避免"假成功"。
        if (!LastKeyInputLanded())
        {
            var viaBroker = TryBrokerKey(key, modifiers ?? Array.Empty<string>());
            if (viaBroker != null) return viaBroker;
        }

        return JsonSerializer.Serialize(new { success = true, data = new { key, modifiers, deliveredVia = "sendinput" } });
    }

    static string ListWindows()
    {
        var windows = new List<Dictionary<string, object>>();
        EnumWindows((hWnd, lParam) =>
        {
            if (IsWindowVisible(hWnd))
            {
                var title = new StringBuilder(256);
                GetWindowText(hWnd, title, 256);
                string titleStr = title.ToString();
                if (titleStr.Length > 0)
                {
                    GetWindowRect(hWnd, out RECT rect);
                    GetWindowThreadProcessId(hWnd, out uint pid);
                    var className = new StringBuilder(256);
                    GetClassName(hWnd, className, 256);
                    windows.Add(new Dictionary<string, object>
                    {
                        ["handle"] = hWnd.ToInt64(),
                        ["title"] = titleStr,
                        ["className"] = className.ToString(),
                        ["processId"] = pid,
                        ["x"] = rect.Left, ["y"] = rect.Top,
                        ["width"] = rect.Right - rect.Left,
                        ["height"] = rect.Bottom - rect.Top,
                        ["minimized"] = IsIconic(hWnd)
                    });
                }
            }
            return true;
        }, IntPtr.Zero);
        return JsonSerializer.Serialize(new { success = true, data = windows });
    }

    static string FocusWindow(string title)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) =>
        {
            if (IsWindowVisible(hWnd))
            {
                var sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                if (sb.ToString().Contains(title)) { found = hWnd; return false; }
            }
            return true;
        }, IntPtr.Zero);
        if (found != IntPtr.Zero)
        {
            ShowWindow(found, SW_RESTORE);
            SetForegroundWindow(found);
            return JsonSerializer.Serialize(new { success = true, data = new { handle = found.ToInt64() } });
        }
        return JsonSerializer.Serialize(new { success = false, error = $"Window not found: {title}" });
    }

    static string WindowOp(long handle, string operation)
    {
        var hWnd = new IntPtr(handle);
        switch (operation)
        {
            case "minimize": ShowWindow(hWnd, SW_MINIMIZE); break;
            case "maximize": ShowWindow(hWnd, SW_SHOWMAXIMIZED); break;
            case "restore": ShowWindow(hWnd, SW_RESTORE); break;
            case "close": SendMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero); break;
        }
        return JsonSerializer.Serialize(new { success = true });
    }

    static string CursorPosition()
    {
        GetCursorPos(out POINT pt);
        return JsonSerializer.Serialize(new { success = true, data = new { x = pt.X, y = pt.Y } });
    }

    // 光标形状诊断：悬停在按钮上时句柄通常变成"手形"，可用来判断命中/悬停是否真的生效。
    [StructLayout(LayoutKind.Sequential)]
    struct CURSORINFO
    {
        public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos;
    }

    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO pci);
    [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr hInstance, int lpCursorName);

    const int CURSOR_SHOWING = 0x00000001;
    const int IDC_ARROW = 32512, IDC_HAND = 32649, IDC_IBEAM = 32513, IDC_WAIT = 32514,
              IDC_CROSS = 32515, IDC_SIZENS = 32645, IDC_SIZEWE = 32644, IDC_NO = 32648;

    static string CursorShapeName(IntPtr h)
    {
        var known = new (int id, string name)[]
        {
            (IDC_ARROW, "arrow"), (IDC_HAND, "hand"), (IDC_IBEAM, "ibeam"), (IDC_WAIT, "wait"),
            (IDC_CROSS, "cross"), (IDC_SIZENS, "size-ns"), (IDC_SIZEWE, "size-we"), (IDC_NO, "no"),
        };
        foreach (var k in known)
        {
            IntPtr refCursor = LoadCursor(IntPtr.Zero, k.id);
            if (refCursor != IntPtr.Zero && refCursor == h) return k.name;
        }
        return "other";
    }

    /// <summary>
    /// UIA 的 BoundingRectangle 来自系统 UIA 客户端，返回的是物理像素；而本进程的
    /// SetCursorPos / GetCursorPos / WindowFromPoint 都工作在被 DPI 虚拟化过的逻辑
    /// 坐标系里。实测两者相差 1.75 倍（本机 175% 缩放），直接拿 UIA 坐标去点会点到
    /// 别的窗口上，所以这里统一换算成鼠标 API 使用的逻辑坐标。
    /// </summary>
    static void UiaToPointerSpace(ref int x, ref int y)
    {
        try
        {
            IntPtr dc = GetDC(IntPtr.Zero);
            if (dc == IntPtr.Zero) return;
            int pw = GetDeviceCaps(dc, 118);   // DESKTOPHORZRES 物理宽
            int ph = GetDeviceCaps(dc, 117);   // DESKTOPVERTRES 物理高
            ReleaseDC(IntPtr.Zero, dc);
            int vw = GetSystemMetrics(0);
            int vh = GetSystemMetrics(1);
            if (pw <= 0 || ph <= 0 || vw <= 0 || vh <= 0) return;
            if (pw == vw && ph == vh) return;  // 没有缩放，坐标一致
            x = (int)Math.Round(x * (double)vw / pw);
            y = (int)Math.Round(y * (double)vh / ph);
        }
        catch { }
    }

    /// <summary>诊断：报告若干坐标点上命中的窗口，用来核对各坐标系是否一致。</summary>
    static string ProbePoints(JsonElement points)
    {
        var results = new List<object>();
        foreach (var p in points.EnumerateArray())
        {
            int px = p.GetProperty("x").GetInt32();
            int py = p.GetProperty("y").GetInt32();
            IntPtr hwnd = WindowFromPoint(new POINT { X = px, Y = py });
            IntPtr root = GetAncestor(hwnd, GA_ROOT);
            string title = "";
            try { var sb = new StringBuilder(256); GetWindowText(root, sb, 256); title = sb.ToString(); } catch { }
            results.Add(new { x = px, y = py, handle = root.ToInt64(), title });
        }
        return JsonSerializer.Serialize(new
        {
            success = true,
            data = new
            {
                metrics = new { screenWidth = GetSystemMetrics(0), screenHeight = GetSystemMetrics(1) },
                points = results,
            }
        });
    }

    static string CursorInfo()
    {
        var ci = new CURSORINFO();
        ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
        if (!GetCursorInfo(ref ci)) return JsonSerializer.Serialize(new { success = false, error = "GetCursorInfo failed" });
        IntPtr hwnd = WindowFromPoint(ci.ptScreenPos);
        IntPtr root = GetAncestor(hwnd, GA_ROOT);
        string title = "";
        try { var sb = new StringBuilder(256); GetWindowText(root, sb, 256); title = sb.ToString(); } catch { }
        return JsonSerializer.Serialize(new
        {
            success = true,
            data = new
            {
                x = ci.ptScreenPos.X,
                y = ci.ptScreenPos.Y,
                showing = (ci.flags & CURSOR_SHOWING) != 0,
                shape = CursorShapeName(ci.hCursor),
                windowUnderCursor = title,
                windowHandle = root.ToInt64(),
            }
        });
    }

    [STAThread]
    public static int Main(string[] args)
    {
        // 提权启动 broker 时用命令行开关，避免把 JSON 塞进命令行导致引号被吞。
        // 例：Win32Bridge.exe --broker 45919
        var brokerIdx = Array.IndexOf(args, "--broker");
        if (brokerIdx >= 0 && brokerIdx + 1 < args.Length && int.TryParse(args[brokerIdx + 1], out int brokerPort))
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            try { Console.Out.WriteLine(RunBroker(brokerPort, Array.IndexOf(args, "--print-token") >= 0)); }
            catch (Exception ex) { Console.Out.WriteLine(JsonSerializer.Serialize(new { success = false, error = ex.Message })); return 1; }
            return 0;
        }

        // 只打印/生成令牌（安装脚本用）。已有令牌时原样返回，绝不覆盖 ——
        // 覆盖会让正在运行的 broker 与客户端令牌失配。
        if (Array.IndexOf(args, "--token") >= 0)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            string t = EnsureBrokerToken();
            Console.Out.WriteLine(JsonSerializer.Serialize(new { success = t != null, data = new { token = t, tokenFile = BrokerTokenPath() } }));
            return t != null ? 0 : 1;
        }

        try
        {
            // 诊断用旁路：允许用 CLI 传 JSON / 把结果写文件，方便脱离插件管道单测。
            // 传了 --json 就不再读 stdin（stdin 为空时读它会直接抛解析错误）。
            string outFile = null;
            var outIdx = Array.IndexOf(args, "--out");
            if (outIdx >= 0 && outIdx + 1 < args.Length) outFile = args[outIdx + 1];

            string input = null;
            // 环境变量最省事（不受 Windows 命令行引号规则折磨）
            input = Environment.GetEnvironmentVariable("DSH_BRIDGE_JSON");
            if (string.IsNullOrWhiteSpace(input))
            {
                var argIdx = Array.IndexOf(args, "--json");
                if (argIdx >= 0 && argIdx + 1 < args.Length) input = args[argIdx + 1];
            }
            if (string.IsNullOrWhiteSpace(input))
            {
                input = Console.In.ReadToEnd();
            }
            if (string.IsNullOrWhiteSpace(input))
            {
                Console.Out.WriteLine(JsonSerializer.Serialize(new
                {
                    success = false,
                    error = "no command received: pass JSON on stdin, or set DSH_BRIDGE_JSON, or use --json '<json>'"
                }));
                return 1;
            }

            using var doc = JsonDocument.Parse(input);
            var root = doc.RootElement;
            string action = root.GetProperty("action").GetString();
            // 注意：这里用 UTF-8 输出，中文不再被转义成 \uXXXX（Windows 控制台默认
            // 代码页会让中文变成乱码，调用端需要按 UTF-8 解码）。
            Console.OutputEncoding = new UTF8Encoding(false);

            string result = action switch
            {
                "screenshot" => Screenshot(),
                "click" => Click(root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32(),
                    root.TryGetProperty("button", out var b) ? b.GetString() : "left",
                    root.TryGetProperty("count", out var c) ? c.GetInt32() : 1),
                "mouse_move" => MouseMove(root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32()),
                "drag" => Drag(root.GetProperty("fromX").GetInt32(), root.GetProperty("fromY").GetInt32(),
                    root.GetProperty("toX").GetInt32(), root.GetProperty("toY").GetInt32()),
                "scroll" => Scroll(root.TryGetProperty("amount", out var a) ? a.GetInt32() : 3,
                    root.TryGetProperty("direction", out var d) ? d.GetString() : "down"),
                "type" => Type(root.GetProperty("text").GetString(),
                    root.TryGetProperty("preferNativeInput", out var pni) && pni.GetBoolean()),
                "diagnose" => Diagnose(!root.TryGetProperty("liveTest", out var lt) || lt.GetBoolean()),
                "broker" => RunBroker(root.TryGetProperty("port", out var bp) ? bp.GetInt32() : 45919, true),
                "key" => Key(root.GetProperty("key").GetString(),
                    root.TryGetProperty("modifiers", out var mods) ? mods.EnumerateArray().Select(m => m.GetString()).ToArray() : Array.Empty<string>()),
                "list_windows" => ListWindows(),
                "focus_window" => FocusWindow(root.GetProperty("title").GetString()),
                "window_op" => WindowOp(root.GetProperty("handle").GetInt64(), root.GetProperty("operation").GetString()),
                "cursor_position" => CursorPosition(),
                "cursor_info" => CursorInfo(),
                "probe_point" => ProbePoints(root.GetProperty("points")),
                "move_check" => JsonSerializer.Serialize(new
                {
                    success = true,
                    data = new
                    {
                        requested = new[] { root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32() },
                        before = ReadCursorPair(),
                        moveResult = MoveCursorVerified(root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32()),
                        after = ReadCursorPair(),
                        afterSetCursorPos = SetCursorPosAndRead(root.GetProperty("x").GetInt32(), root.GetProperty("y").GetInt32()),
                        metrics = new { screen = new[] { GetSystemMetrics(0), GetSystemMetrics(1) } },
                    }
                }),
                "ui_elements" => GetUiElements(
                    root.TryGetProperty("title", out var t) ? t.GetString() : null,
                    root.TryGetProperty("includeText", out var it) && it.GetBoolean()),
                "window_text" => GetWindowText(root.GetProperty("title").GetString()),
                "click_element" => ClickElement(
                    root.TryGetProperty("title", out var ct) ? ct.GetString() : null,
                    root.GetProperty("target").GetString(),
                    0, 0),
                "wait_for" => WaitForCondition(
                    root.GetProperty("condition").GetString(),
                    root.GetProperty("target").GetString(),
                    root.TryGetProperty("timeoutMs", out var to) ? to.GetInt32() : 5000),
                "clipboard" => ClipboardAction(
                    root.GetProperty("operation").GetString(),
                    root.TryGetProperty("text", out var clipText) ? clipText.GetString() : null),
                "esc_watch" => EscWatch(
                    root.GetProperty("pauseFile").GetString(),
                    root.GetProperty("stopFile").GetString()),
                "glow_run" => GlowRun(
                    root.TryGetProperty("text", out var glowText) ? glowText.GetString() : "",
                    root.GetProperty("stopFile").GetString()),
                _ => JsonSerializer.Serialize(new { success = false, error = $"Unknown action: {action}" })
            };

            Console.Out.WriteLine(result);
            if (outFile != null) { try { File.WriteAllText(outFile, result); } catch { } }
            return 0;
        }
        catch (Exception ex)
        {
            string errJson = JsonSerializer.Serialize(new { success = false, error = ex.Message });
            Console.Out.WriteLine(errJson);
            try
            {
                var outIdx2 = Array.IndexOf(args, "--out");
                if (outIdx2 >= 0 && outIdx2 + 1 < args.Length) File.WriteAllText(args[outIdx2 + 1], errJson);
            }
            catch { }
            return 1;
        }    }

    // === UI Automation methods ===

    // Get UI Automation elements for a window (by title or foreground)
    static string GetUiElements(string title, bool includeText)
    {
        AutomationElement root = null;
        if (!string.IsNullOrEmpty(title))
        {
            root = FindWindowByTitle(title);
        }
        else
        {
            root = AutomationElement.FocusedElement;
            if (root == null)
            {
                root = AutomationElement.RootElement;
            }
        }

        if (root == null)
        {
            return JsonSerializer.Serialize(new { success = false, error = "Window not found" });
        }

        var elements = new List<Dictionary<string, object>>();

        // Helper to safely get rectangle values
        static double SafeRectVal(double v) => double.IsInfinity(v) || double.IsNaN(v) ? 0 : v;

        // Add the root window itself
        elements.Add(new Dictionary<string, object>
        {
            ["index"] = 0,
            ["role"] = "window",
            ["name"] = root.Current.Name,
            ["className"] = root.Current.ClassName,
            ["automationId"] = root.Current.AutomationId,
            ["bounds"] = new Dictionary<string, object>
            {
                ["x"] = SafeRectVal(root.Current.BoundingRectangle.X),
                ["y"] = SafeRectVal(root.Current.BoundingRectangle.Y),
                ["width"] = SafeRectVal(root.Current.BoundingRectangle.Width),
                ["height"] = SafeRectVal(root.Current.BoundingRectangle.Height)
            },
            ["clickable"] = true,
            ["focused"] = root.Current.HasKeyboardFocus,
            ["enabled"] = root.Current.IsEnabled
        });

        // Use FindAll for reliable descendant traversal
        var descendants = root.FindAll(TreeScope.Descendants, Condition.TrueCondition);
        int index = 1;
        foreach (AutomationElement child in descendants)
        {
            if (index >= 500) break;
            try
            {
                var name = child.Current.Name;
                var role = child.Current.ControlType.ProgrammaticName;
                var classList = child.Current.ClassName;
                var autoId = child.Current.AutomationId;
                var rect = child.Current.BoundingRectangle;

                // Only include elements that have a name or are interactive
                if (!string.IsNullOrEmpty(name) || !string.IsNullOrEmpty(autoId) || IsInteractive(child))
                {
                    var elem = new Dictionary<string, object>
                    {
                        ["index"] = index,
                        ["role"] = role,
                        ["name"] = name ?? "",
                        ["className"] = classList ?? "",
                        ["automationId"] = autoId ?? "",
                        ["bounds"] = new Dictionary<string, object>
                        {
                            ["x"] = SafeRectVal(rect.X),
                            ["y"] = SafeRectVal(rect.Y),
                            ["width"] = SafeRectVal(rect.Width),
                            ["height"] = SafeRectVal(rect.Height)
                        },
                        ["clickable"] = IsClickable(child),
                        ["focused"] = child.Current.HasKeyboardFocus,
                        ["enabled"] = child.Current.IsEnabled
                    };

                    if (includeText)
                    {
                        elem["text"] = GetElementText(child);
                    }

                    elements.Add(elem);
                    index++;
                }
            }
            catch { }
        }

        return JsonSerializer.Serialize(new { success = true, data = new { elements = elements, count = elements.Count } });
    }

    static AutomationElement FindWindowByTitle(string title)
    {
        var windows = AutomationElement.RootElement.FindAll(TreeScope.Children,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window));
        foreach (AutomationElement w in windows)
        {
            if (w.Current.Name.Contains(title))
            {
                return w;
            }
        }
        return null;
    }

    static bool IsClickable(AutomationElement element)
    {
        try
        {
            var patterns = element.GetSupportedPatterns();
            foreach (var p in patterns)
            {
                if (p.ProgrammaticName == "InvokePatternIdentifiers.Pattern" ||
                    p.ProgrammaticName == "TogglePatternIdentifiers.Pattern" ||
                    p.ProgrammaticName == "SelectionItemPatternIdentifiers.Pattern")
                {
                    return true;
                }
            }
            return false;
        }
        catch { return false; }
    }

    static bool IsInteractive(AutomationElement element)
    {
        try
        {
            var patterns = element.GetSupportedPatterns();
            foreach (var p in patterns)
            {
                if (p.ProgrammaticName == "InvokePatternIdentifiers.Pattern" ||
                    p.ProgrammaticName == "ValuePatternIdentifiers.Pattern" ||
                    p.ProgrammaticName == "TogglePatternIdentifiers.Pattern" ||
                    p.ProgrammaticName == "SelectionItemPatternIdentifiers.Pattern")
                {
                    return true;
                }
            }
            return false;
        }
        catch { return false; }
    }

    static string GetElementText(AutomationElement element)
    {
        try
        {
            // Try ValuePattern first
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out object valueObj))
            {
                var valuePattern = (ValuePattern)valueObj;
                return valuePattern.Current.Value;
            }

            // Try Name
            if (!string.IsNullOrEmpty(element.Current.Name))
            {
                return element.Current.Name;
            }

            // Try GetText
            var textPattern = element.GetCurrentPattern(TextPattern.Pattern) as TextPattern;
            if (textPattern != null)
            {
                return textPattern.DocumentRange.GetText(-1);
            }
        }
        catch { }
        return "";
    }

    // Get window text content (for reading documents, web pages, etc.)
    static string GetWindowText(string title)
    {
        var element = FindWindowByTitle(title);
        if (element == null)
        {
            return JsonSerializer.Serialize(new { success = false, error = "Window not found" });
        }

        var walker = TreeWalker.ControlViewWalker;
        var texts = new List<string>();

        // Walk all descendants and collect text
        var all = element.FindAll(TreeScope.Descendants, Condition.TrueCondition);
        foreach (AutomationElement elem in all)
        {
            try
            {
                var text = GetElementText(elem);
                if (!string.IsNullOrWhiteSpace(text) && text.Length < 1000)
                {
                    texts.Add(text);
                }
            }
            catch { }
        }

        // Take last 4000 characters
        var result = string.Join("\n", texts);
        if (result.Length > 4000)
        {
            result = result.Substring(result.Length - 4000);
        }

        return JsonSerializer.Serialize(new { success = true, data = new { text = result, length = result.Length } });
    }

    // Click on element by name (target parameter)
    static string ClickElement(string title, string targetName, int x, int y)
    {
        AutomationElement root;
        if (!string.IsNullOrEmpty(title))
        {
            root = FindWindowByTitle(title);
        }
        else
        {
            root = AutomationElement.FocusedElement;
        }

        if (root == null)
        {
            return JsonSerializer.Serialize(new { success = false, error = "Window not found" });
        }

        // Find element by name
        var element = FindElementByName(root, targetName);
        if (element == null)
        {
            return JsonSerializer.Serialize(new { success = false, error = $"Element not found: {targetName}" });
        }

        // Try to invoke
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out object invokeObj))
        {
            ((InvokePattern)invokeObj).Invoke();
            return JsonSerializer.Serialize(new { success = true, data = new { method = "invoke", name = targetName } });
        }

        // Try selection
        if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out object selObj))
        {
            ((SelectionItemPattern)selObj).Select();
            return JsonSerializer.Serialize(new { success = true, data = new { method = "select", name = targetName } });
        }

        // Try toggle
        if (element.TryGetCurrentPattern(TogglePattern.Pattern, out object toggleObj))
        {
            ((TogglePattern)toggleObj).Toggle();
            return JsonSerializer.Serialize(new { success = true, data = new { method = "toggle", name = targetName } });
        }

        // 旧式控件 / 降级的 UIA 桥只给 MSAA：直接在那个点上执行默认动作。
        {
            int mx = (int)(element.Current.BoundingRectangle.X + element.Current.BoundingRectangle.Width / 2);
            int my = (int)(element.Current.BoundingRectangle.Y + element.Current.BoundingRectangle.Height / 2);
            UiaToPointerSpace(ref mx, ref my);
            var msaa = TryMsaaDefaultActionAt(new POINT { X = mx, Y = my });
            if (msaa != null) return msaa;
        }

        // Fallback: click at center of element
        var rect = element.Current.BoundingRectangle;
        if (rect.Width > 0 && rect.Height > 0)
        {
            // UIA 是物理像素，鼠标 API 是逻辑像素，必须先换算，否则高 DPI 下会点偏。
            int cx = (int)(rect.X + rect.Width / 2);
            int cy = (int)(rect.Y + rect.Height / 2);
            UiaToPointerSpace(ref cx, ref cy);

            // 本进程注入被拦时，先试提权 broker（唯一能真正点到的通道）。
            if (!MoveCursorVerified(cx, cy))
            {
                var viaBroker = TryBrokerClick(cx, cy, "left", 1);
                if (viaBroker != null) return viaBroker;
            }

            // 合成输入可能被会话策略拦截：先校验光标真的到位，再决定是否点击。
            if (!MoveCursorVerified(cx, cy))
            {
                int ax, ay;
                ReadCursor(out ax, out ay);
                return JsonSerializer.Serialize(new
                {
                    success = false,
                    error = $"element '{targetName}' has no Invoke/Select/Toggle pattern and synthetic input is blocked " +
                            $"(cursor stayed at ({ax},{ay}) instead of ({cx},{cy})); cannot click it. " +
                            "Pick a different target name that exposes a UIA pattern, or drive the app through UIA values.",
                    data = new { canInjectInput = false, requestedX = cx, requestedY = cy, actualX = ax, actualY = ay, inputBlocked = true }
                });
            }
            Thread.Sleep(50);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(30);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            return JsonSerializer.Serialize(new { success = true, data = new { method = "click", x = cx, y = cy, name = targetName } });
        }

        return JsonSerializer.Serialize(new { success = false, error = $"Cannot interact with element: {targetName}" });
    }

    static AutomationElement FindElementByName(AutomationElement root, string name)
    {
        // Search by name property
        var element = root.FindFirst(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.NameProperty, name));
        if (element != null) return element;

        // Search by automation id
        element = root.FindFirst(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, name));
        if (element != null) return element;

        // Search by class name
        element = root.FindFirst(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ClassNameProperty, name));
        if (element != null) return element;

        return null;
    }

    // Wait for a condition (window or element to appear/disappear)
    static string WaitForCondition(string condition, string target, int timeoutMs)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            try
            {
                if (condition == "window")
                {
                    var w = FindWindowByTitle(target);
                    if (w != null)
                    {
                        return JsonSerializer.Serialize(new { success = true, data = new { found = true, target } });
                    }
                }
                else if (condition == "element")
                {
                    var root = AutomationElement.FocusedElement;
                    if (root != null)
                    {
                        var e = FindElementByName(root, target);
                        if (e != null)
                        {
                            return JsonSerializer.Serialize(new { success = true, data = new { found = true, target } });
                        }
                    }
                }
                else if (condition == "disappear")
                {
                    var w = FindWindowByTitle(target);
                    if (w == null)
                    {
                        return JsonSerializer.Serialize(new { success = true, data = new { found = false, target } });
                    }
                }
            }
            catch { }
            Thread.Sleep(200);
        }
        return JsonSerializer.Serialize(new { success = false, error = $"Timeout waiting for {condition}: {target}" });
    }

    // Clipboard read/write
    static string ClipboardAction(string action, string text)
    {
        if (action == "read")
        {
            string clipText = Clipboard.GetText();
            return JsonSerializer.Serialize(new { success = true, data = new { text = clipText } });
        }
        else if (action == "write")
        {
            Clipboard.SetText(text);
            return JsonSerializer.Serialize(new { success = true, data = new { text = text } });
        }
        return JsonSerializer.Serialize(new { success = false, error = "Unknown clipboard action" });
    }

    // === Esc Pause/Resume ===

    static string EscWatch(string pauseFile, string stopFile)
    {
        // Low-level keyboard hooks are dispatched through the installing thread's
        // message queue, so this loop must pump messages (DoEvents) or the
        // callback never fires and Esc is never seen.
        var hook = new KeyboardHook();
        hook.EscPressed += (s, e) =>
        {
            try
            {
                if (File.Exists(pauseFile)) File.Delete(pauseFile);
                else File.WriteAllText(pauseFile, "paused");
            }
            catch { }
        };
        hook.Start();
        while (!File.Exists(stopFile))
        {
            Application.DoEvents();
            Thread.Sleep(20);
        }
        hook.Stop();
        try { File.Delete(stopFile); } catch { }
        return JsonSerializer.Serialize(new { success = true });
    }

    // === Orange Glow Overlay ===

    // Runs until stopFile appears. Started as a detached background process by
    // the plugin so the overlay outlives a single one-shot bridge call.
    static string GlowRun(string text, string stopFile)
    {
        var form = new GlowForm();
        if (!string.IsNullOrEmpty(text))
        {
            var label = new Label
            {
                Text = text,
                ForeColor = Color.White,
                BackColor = Color.FromArgb(255, 140, 0),
                Font = new Font("Microsoft YaHei UI", 12F, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(28, 28),
                Padding = new Padding(10, 6, 10, 6),
            };
            form.Controls.Add(label);
        }
        var timer = new System.Windows.Forms.Timer { Interval = 200 };
        timer.Tick += (s, e) =>
        {
            if (File.Exists(stopFile))
            {
                timer.Stop();
                form.Close();
            }
        };
        timer.Start();
        Application.Run(form);
        try { File.Delete(stopFile); } catch { }
        return JsonSerializer.Serialize(new { success = true });
    }

    // Border-only overlay: transparent background, click-through, never activated.
    class GlowForm : Form
    {
        const int WS_EX_TRANSPARENT = 0x00000020;
        const int WS_EX_LAYERED = 0x00080000;
        const int WS_EX_TOOLWINDOW = 0x00000080;
        const int WS_EX_NOACTIVATE = 0x08000000;

        public GlowForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = Screen.PrimaryScreen.Bounds;
            TopMost = true;
            ShowInTaskbar = false;
            BackColor = Color.Magenta;
            TransparencyKey = Color.Magenta;
            DoubleBuffered = true;
        }

        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
                return cp;
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            const int thickness = 10;
            using var pen = new Pen(Color.FromArgb(255, 140, 0), thickness);
            e.Graphics.DrawRectangle(pen, thickness / 2, thickness / 2,
                ClientSize.Width - thickness, ClientSize.Height - thickness);
        }
    }

    // Keyboard hook for Esc detection
    class KeyboardHook : IDisposable
    {
        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
        private LowLevelKeyboardProc _proc;
        private IntPtr _hookID = IntPtr.Zero;

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        public event EventHandler EscPressed;

        public void Start()
        {
            _proc = HookCallback;
            _hookID = SetHook(_proc);
        }

        public void Stop()
        {
            UnhookWindowsHookEx(_hookID);
        }

        private IntPtr SetHook(LowLevelKeyboardProc proc)
        {
            using (var curProcess = System.Diagnostics.Process.GetCurrentProcess())
            using (var curModule = curProcess.MainModule)
            {
                return SetWindowsHookEx(13, proc, GetModuleHandle(curModule.ModuleName), 0);
            }
        }

        private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && wParam == (IntPtr)0x0100) // WM_KEYDOWN
            {
                int vkCode = Marshal.ReadInt32(lParam);
                if (vkCode == 0x1B) // VK_ESCAPE
                {
                    EscPressed?.Invoke(this, EventArgs.Empty);
                }
            }
            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }

        public void Dispose()
        {
            Stop();
        }
    }
}
