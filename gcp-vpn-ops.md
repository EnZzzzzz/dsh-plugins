# GCP 翻墙节点运维文档

> 一台 Google Cloud 免费层级 VPS 上的 hy2 + tuic 双协议节点，含订阅托管（带流量统计）与配置版本管理。
> 读完本文即可独立完成日常修改与维护。最后更新：2026-08-16（v8 脚本）

## 1. 总览

```
手机/电脑客户端 (Shadowrocket / Clash Verge)
        │  UDP 443 (Hysteria2) / UDP 8443 (TUIC v5)
        ▼
GCP 实例 vpn-node (us-west1-b, e2-micro, Debian 13)
        └─ sing-box（官方原版，两个协议一个进程）
        └─ sub-server.py :80（托管订阅 yaml，返回 Subscription-Userinfo 流量信息头）
        └─ iptables VPN-IN/VPN-OUT 链（统计 443/8443 流量）
        └─ /etc/vpn/repo（git 仓库，每次开机自动提交配置）
        ▼
    出站到目标网站
```

- GCP 项目：`evident-display-505609-j0`（控制台显示名 My Project 60726）
- 控制台入口：https://console.cloud.google.com/compute/instances?project=evident-display-505609-j0

## 2. 资源清单

| 资源 | 值 | 说明 |
|---|---|---|
| 实例 | `vpn-node`，us-west1-b | e2-micro（2 共享 vCPU / 1GB），Debian 13 |
| 启动磁盘 | 30GB **标准**永久性磁盘 | 免费层级要求标准盘，别改成平衡盘 |
| 外部 IP | `35.212.220.175`（**静态**，Standard 层级） | 静态名 `vpn-ip`，挂载在用与临时同价 $0.005/h |
| 网络层级 | **Standard** | 每月 200GB 免费出站流量；Premium 到中国 $0.23/GiB |
| 防火墙规则 | `allow-vpn-udp`：入站 UDP 443、8443 | 另有一条 `allow-vpn-tcp80`：入站 TCP 80（订阅服务） |
| 免费试用 | $300 / 90 天（2026-08-15 起） | 到期或耗尽后需升级付费账号，否则资源回收 |

## 3. 节点参数（客户端要填的就这些）

订阅地址（推荐，客户端直接添加订阅即可）：

```
http://35.212.220.175/sub-736079d1.yaml
```

手动配置参数：

| | hy2 | tuic |
|---|---|---|
| 协议 | hysteria2 | tuic |
| 服务器 | 35.212.220.175 | 35.212.220.175 |
| 端口 | 443 (UDP) | 8443 (UDP) |
| 密码 | `mpJla03Uku2WeT4apBOzixQN` | `TUvGGssIEJ0AQPRRNccTliuh` |
| UUID | — | `26e41aee-275e-47d8-9f4f-464382e53d5d` |
| SNI | www.bing.com | www.bing.com |
| 证书 | 自签，客户端需跳过证书验证 | 同左 |
| 拥塞控制 | 协议自带 | bbr |

订阅 yaml 内容就是本仓库的 `clash-verge-nodes.yaml`，含分流规则：
国内域名/IP（GEOSITE,cn / GEOIP,CN）直连，其余走代理。

## 4. 服务端实现细节

**关键机制：一切都由实例的"启动脚本"（startup-script 元数据）驱动。**
实例每次开机都会执行该脚本：安装 sing-box → 写配置 → 签发证书 → 启动服务 → 写订阅文件 → 启动订阅服务。因此**改任何服务端配置 = 改启动脚本 + 重启实例**，不需要 SSH。

实例上的文件：

| 路径 | 内容 |
|---|---|
| `/etc/sing-box/config.json` | sing-box 配置（hy2 + tuic 入站） |
| `/etc/sing-box/cert.pem` / `key.pem` | 自签证书（CN=www.bing.com，10 年） |
| `/var/www/sub/sub-736079d1.yaml` | 订阅文件（由脚本内嵌内容生成） |
| `/usr/local/bin/sub-server.py` | 订阅 HTTP 服务（见下「流量统计显示」） |
| `/etc/vpn/traffic.json` | 流量累计状态（跨重启、跨月自动清零） |
| `/etc/vpn/repo/` | git 仓库，每次开机自动提交 config/订阅/订阅服务脚本三份文件 |
| `/var/log/vpn-setup.log` | 启动脚本执行日志（排查首选） |
| systemd 服务 | `sing-box.service`、`sub-serve.service`（均开机自启 + 失败自动重启） |

### 流量统计显示（Subscription-Userinfo）

客户端（Clash Verge / Shadowrocket 等）订阅卡片上的「已用 / 总量」来自订阅接口的
`Subscription-Userinfo` 响应头。实现方式：

- 启动脚本建立 iptables 链 `VPN-IN`（udp dport 443/8443，= 用户上传）和 `VPN-OUT`（udp sport 443/8443，= 用户下载），只计数不拦截
- `sub-server.py` 每次收到订阅请求时读计数器，叠加 `/etc/vpn/traffic.json` 里的基数（解决重启后计数器归零），按自然月清零
- 总量写死 200GiB（Standard 层级免费出站额度），到期时间为次月 1 号
- 订阅内容里还会动态注入两个"信息节点"（仿机场做法）：`剩余流量：xx GB` 和 `流量重置：yyyy-mm-dd`，是 127.0.0.1 的 dummy ss 节点，仅供 Shadowrocket / Clash Verge 节点列表里展示用，选中它没有网络；注入逻辑在 `sub-server.py` 的 do_GET 里，静态 yaml 模板（仓库里的 `clash-verge-nodes.yaml`）不含这两个节点
- 注意：卡片显示的"已用"是上传+下载之和，而 GCP 只对下载（出站）计费，所以显示偏保守
- 该服务只实现了 GET；用 `curl -I`（HEAD）测会返回 501，要用 `curl -s -D - -o /dev/null <订阅地址>` 验证

### 配置版本管理（实例上的 git）

启动脚本每次开机把 `config.json`、订阅 yaml、`sub-server.py` 复制到 `/etc/vpn/repo` 并自动 commit（message 为开机时间）。重置实例不清磁盘，历史持续累积。改坏了想回退：看 `/etc/vpn/repo` 的 git log 找到旧版本内容，改进启动脚本后重置。本地仓库的 `gcp-vpn-startup.sh` 是启动脚本的副本，两边同步改。

### sing-box 配置要点（改配置时注意）

- hy2 入站：`masquerade` 为 `https://www.bing.com`
- tuic 入站 TLS 块里有 `"alpn": ["h3"]` —— **必须保留**，否则 mihomo 内核客户端（Clash Verge 等）握手报 `server did not select an ALPN protocol`。注意 alpn 只能写在 `tls` 块内，写到入站层级会导致 sing-box 无法启动（unknown field），这是踩过的坑
- 配置是严格 JSON，sing-box 遇到未知字段会直接 FATAL 退出并陷入重启循环

## 5. 常见运维操作

### 5.1 修改节点配置（改密码/端口/加用户/改订阅内容）

1. 控制台 → Compute Engine → 虚拟机实例 → `vpn-node` → **修改**
2. 拉到底部「自动化 → 启动脚本」，编辑脚本（配置 JSON 和订阅 yaml 都内嵌在脚本里）
3. **保存**，等 10 秒确认保存生效
4. 回到实例列表，勾选 `vpn-node` → **重置**（reset，非停止）
5. 等约 3-4 分钟（脚本要重新下载安装），再验证

### 5.2 验证节点是否可用

本地装好 sing-box 或 mihomo 后（`brew install sing-box mihomo`），用客户端配置连本机 SOCKS 再访问：

```bash
sing-box run -c client-hy2.json &        # 本地起客户端，监听 127.0.0.1:12080
curl --socks5-hostname 127.0.0.1:12080 https://api.ipify.org
# 返回 35.212.220.175 即节点正常
```

**注意：测试前确认本机没有通过该节点本身代理流量**（Clash Verge 切直连或换别的节点），否则实例一重启，测试流量走死节点，得到假阴性。

### 5.3 查看服务端状态（无 SSH 时）

- 控制台 → 实例详情 → 日志 → **串行端口 1（控制台）**：系统d 启动/崩溃记录都在这里
- 若 sing-box 反复 `Failed with result 'exit-code'`，基本就是 config.json 写错了

### 5.4 SSH（备用通道，当前是坏的）

这台 Debian 13 镜像的 sshd 没起来（systemd-ssh-generator 报错），22 端口无人监听。实例元数据里加过一个调试公钥（私钥在 Mac 的 `/tmp/vpn-test/gcp_key`，/tmp 重启后丢失）。真要 SSH，在启动脚本里加一行重装 ssh 再重置：

```bash
apt-get install -y --reinstall openssh-server && systemctl enable --now ssh
```

## 6. 费用（试用期后）

| 项目 | 费用 |
|---|---|
| e2-micro + 30GB 标准盘 | $0（Always Free，us-west1 每月 1 台） |
| 静态 IPv4（在用） | ~$3.65/月（$0.005/h） |
| 出站流量 ≤200GB/月 | $0（Standard 层级免费额度） |
| **合计（用量 ≤200GB）** | **约 $3.65/月** |

- 试用期 $300 额度内所有费用从额度扣，不扣信用卡
- 建议在控制台「结算 → 预算与提醒」设一个预算告警
- 转正后第一个月核对一次账单：确认 Standard 层级到中国的流量确实按 $0 计（官方费率表未将中国排除在 200GB 外，但以实际账单为准）

## 7. 故障排查记录（踩过的坑）

1. **tuic 在 Clash Verge 不可用、hy2 正常** → sing-box TUIC 入站缺 ALPN，mihomo 强制要求。修复：tls 块加 `"alpn": ["h3"]`
2. **改完配置重启后全挂** → 启动脚本里 JSON 多了非法字段，sing-box FATAL 循环。教训：改完先看串口日志确认启动成功，再做连通测试
3. **保存启动脚本后立刻重置** → 元数据可能没写进去，重启跑的还是旧脚本。教训：保存后回编辑页核对一次再重置
4. **改网络层级（Premium↔Standard）会更换临时 IP** → 订阅里的 IP 全部失效。现已用静态 IP 根治
5. **手机客户端延迟能测出来但上不了网** → iOS VPN 隧道没建立（状态栏无 VPN 图标），和节点无关；本例中换 Shadowrocket 解决（Clash Mi 隧道异常）
6. **改完启动脚本重置后，旧服务还在跑** → `systemctl enable --now xxx` 对已在运行的服务**不会重启**它；重置后旧进程从磁盘上的旧 unit 启动，脚本里的 `enable --now` 不会替换它。脚本里必须用 `enable` + `restart`（v8 已修）
7. **验证订阅接口用 `curl -I` 看到 501** → 新的 sub-server.py 只实现 GET，HEAD 请求返回 501 是正常的，用 `curl -s -D - -o /dev/null` 验证

## 8. 本仓库文件

- `clash-verge-nodes.yaml` —— 订阅源文件（与实例上 `/var/www/sub/sub-736079d1.yaml` 内容一致；改订阅内容时两边同步：改这里 + 改启动脚本内嵌副本 + 重置实例）
- `gcp-vpn-startup.sh` —— 实例启动脚本当前版本（v8）的副本；控制台的启动脚本以这份为准
