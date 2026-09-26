//! 小工具：查看端口占用、结束占用端口的进程（仅 Windows）

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortEntry {
    /// "TCP" 或 "UDP"
    protocol: &'static str,
    address: String,
    port: u16,
    pid: u32,
    /// 进程名，取不到时为空
    name: String,
    /// 可执行文件完整路径，权限不足时为空
    path: Option<String>,
}

/// 列出所有 TCP 监听端口和 UDP 绑定端口，按端口排序
#[tauri::command]
pub async fn port_list() -> Result<Vec<PortEntry>, String> {
    tauri::async_runtime::spawn_blocking(imp::list)
        .await
        .map_err(|e| e.to_string())?
}

/// 强制结束进程
#[tauri::command]
pub async fn process_kill(pid: u32) -> Result<(), String> {
    if pid == 0 || pid == 4 {
        return Err("不能结束系统进程".into());
    }
    if pid == std::process::id() {
        return Err("不能结束编辑器自身".into());
    }
    imp::kill(pid)
}

#[cfg(windows)]
mod imp {
    use super::PortEntry;
    use std::collections::HashMap;
    use std::net::{Ipv4Addr, Ipv6Addr};
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_ACCESS_DENIED, ERROR_INSUFFICIENT_BUFFER, ERROR_INVALID_PARAMETER,
        GetLastError, HANDLE, INVALID_HANDLE_VALUE, NO_ERROR,
    };
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, GetExtendedUdpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID,
        MIB_UDP6ROW_OWNER_PID, MIB_UDPROW_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
        UDP_TABLE_OWNER_PID,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
        QueryFullProcessImageNameW, TerminateProcess,
    };

    /// 句柄离开作用域时自动关闭
    struct Handle(HANDLE);

    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    /// 读取 GetExtendedTcpTable / GetExtendedUdpTable 返回的表：
    /// 开头一个 u32 行数，后面紧跟各行（行里只有 u32 和字节数组，按 4 字节对齐）
    fn read_table<T: Copy>(query: impl Fn(*mut core::ffi::c_void, *mut u32) -> u32) -> Result<Vec<T>, String> {
        let mut size = 0u32;
        let mut buf: Vec<u32> = Vec::new();
        // 两次调用之间表可能变大，缓冲区不够就重试
        for _ in 0..5 {
            let ret = query(buf.as_mut_ptr().cast(), &mut size);
            if ret == NO_ERROR {
                let count = buf.first().copied().unwrap_or(0) as usize;
                let rows = unsafe { buf.as_ptr().add(1).cast::<T>() };
                return Ok((0..count).map(|i| unsafe { rows.add(i).read_unaligned() }).collect());
            }
            if ret != ERROR_INSUFFICIENT_BUFFER {
                return Err(format!("读取端口表失败（错误码 {ret}）"));
            }
            buf = vec![0; (size as usize).div_ceil(4) + 1];
        }
        Err("读取端口表失败：端口表一直在变化".into())
    }

    fn tcp<T: Copy>(family: u16) -> Result<Vec<T>, String> {
        read_table(|p, size| unsafe {
            GetExtendedTcpTable(p, size, 0, family as u32, TCP_TABLE_OWNER_PID_LISTENER, 0)
        })
    }

    fn udp<T: Copy>(family: u16) -> Result<Vec<T>, String> {
        read_table(|p, size| unsafe {
            GetExtendedUdpTable(p, size, 0, family as u32, UDP_TABLE_OWNER_PID, 0)
        })
    }

    /// 端口号以网络字节序存在低 16 位
    fn port(raw: u32) -> u16 {
        u16::from_be(raw as u16)
    }

    fn v4(raw: u32) -> String {
        Ipv4Addr::from(raw.to_ne_bytes()).to_string()
    }

    fn v6(raw: [u8; 16]) -> String {
        format!("[{}]", Ipv6Addr::from(raw))
    }

    /// pid -> 进程名
    fn process_names() -> HashMap<u32, String> {
        let mut names = HashMap::new();
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snap == INVALID_HANDLE_VALUE {
            return names;
        }
        let snap = Handle(snap);
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut ok = unsafe { Process32FirstW(snap.0, &mut entry) };
        while ok != 0 {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            names.insert(entry.th32ProcessID, String::from_utf16_lossy(&entry.szExeFile[..len]));
            ok = unsafe { Process32NextW(snap.0, &mut entry) };
        }
        names
    }

    /// 可执行文件完整路径；系统进程或其他用户的进程可能没有权限读取
    fn process_path(pid: u32) -> Option<String> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return None;
        }
        let handle = Handle(handle);
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = unsafe { QueryFullProcessImageNameW(handle.0, 0, buf.as_mut_ptr(), &mut len) };
        (ok != 0).then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }

    pub fn list() -> Result<Vec<PortEntry>, String> {
        // (协议, 地址, 端口, pid)
        let mut rows: Vec<(&'static str, String, u16, u32)> = Vec::new();
        for r in tcp::<MIB_TCPROW_OWNER_PID>(AF_INET)? {
            rows.push(("TCP", v4(r.dwLocalAddr), port(r.dwLocalPort), r.dwOwningPid));
        }
        for r in tcp::<MIB_TCP6ROW_OWNER_PID>(AF_INET6)? {
            rows.push(("TCP", v6(r.ucLocalAddr), port(r.dwLocalPort), r.dwOwningPid));
        }
        for r in udp::<MIB_UDPROW_OWNER_PID>(AF_INET)? {
            rows.push(("UDP", v4(r.dwLocalAddr), port(r.dwLocalPort), r.dwOwningPid));
        }
        for r in udp::<MIB_UDP6ROW_OWNER_PID>(AF_INET6)? {
            rows.push(("UDP", v6(r.ucLocalAddr), port(r.dwLocalPort), r.dwOwningPid));
        }

        let names = process_names();
        let mut paths: HashMap<u32, Option<String>> = HashMap::new();
        let mut list: Vec<PortEntry> = rows
            .into_iter()
            .map(|(protocol, address, port, pid)| PortEntry {
                protocol,
                address,
                port,
                pid,
                name: match pid {
                    0 => "System Idle Process".into(),
                    4 => "System".into(),
                    _ => names.get(&pid).cloned().unwrap_or_default(),
                },
                path: paths.entry(pid).or_insert_with(|| process_path(pid)).clone(),
            })
            .collect();
        list.sort_by(|a, b| {
            (a.port, a.protocol, a.pid, &a.address).cmp(&(b.port, b.protocol, b.pid, &b.address))
        });
        list.dedup_by(|a, b| (a.port, a.protocol, a.pid, &a.address) == (b.port, b.protocol, b.pid, &b.address));
        Ok(list)
    }

    pub fn kill(pid: u32) -> Result<(), String> {
        let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
        if handle.is_null() {
            return Err(match unsafe { GetLastError() } {
                ERROR_ACCESS_DENIED => "拒绝访问：该进程可能属于系统或其他用户，请以管理员身份运行编辑器后重试".into(),
                ERROR_INVALID_PARAMETER => "进程不存在，可能已经退出".into(),
                code => format!("打开进程失败（错误码 {code}）"),
            });
        }
        let handle = Handle(handle);
        if unsafe { TerminateProcess(handle.0, 1) } == 0 {
            let code = unsafe { GetLastError() };
            return Err(if code == ERROR_ACCESS_DENIED {
                "拒绝访问：请以管理员身份运行编辑器后重试".into()
            } else {
                format!("结束进程失败（错误码 {code}）")
            });
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::PortEntry;

    pub fn list() -> Result<Vec<PortEntry>, String> {
        Err("端口查看目前只支持 Windows".into())
    }

    pub fn kill(_pid: u32) -> Result<(), String> {
        Err("结束进程目前只支持 Windows".into())
    }
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn lists_own_listener() {
        let tcp = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let udp = std::net::UdpSocket::bind("[::1]:0").unwrap();
        let list = super::imp::list().unwrap();
        let pid = std::process::id();
        let find = |proto: &str, port: u16| {
            list.iter().find(|e| e.protocol == proto && e.port == port && e.pid == pid)
        };
        let t = find("TCP", tcp.local_addr().unwrap().port()).expect("找不到 TCP 监听端口");
        assert_eq!(t.address, "127.0.0.1");
        assert!(t.name.to_lowercase().ends_with(".exe"));
        assert!(t.path.is_some());
        let u = find("UDP", udp.local_addr().unwrap().port()).expect("找不到 UDP 端口");
        assert_eq!(u.address, "[::1]");
    }
}
