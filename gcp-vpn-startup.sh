#!/bin/bash
exec > /var/log/vpn-setup.log 2>&1
set -ex

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl openssl tar ca-certificates git iptables

VER=$(curl -fsSL https://api.github.com/repos/SagerNet/sing-box/releases/latest | grep '"tag_name"' | cut -d'"' -f4 | sed 's/^v//')
curl -fsSL -o /tmp/sb.tgz "https://github.com/SagerNet/sing-box/releases/download/v${VER}/sing-box-${VER}-linux-amd64.tar.gz"
tar -xzf /tmp/sb.tgz -C /tmp
install -m 755 "/tmp/sing-box-${VER}-linux-amd64/sing-box" /usr/local/bin/sing-box

mkdir -p /etc/sing-box
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout /etc/sing-box/key.pem -out /etc/sing-box/cert.pem \
  -days 3650 -nodes -subj "/CN=www.bing.com"
chmod 600 /etc/sing-box/key.pem

cat > /etc/sing-box/config.json <<'EOC'
{
  "log": { "level": "warn" },
  "inbounds": [
    {
      "type": "hysteria2",
      "tag": "hy2-in",
      "listen": "::",
      "listen_port": 443,
      "users": [
        { "name": "user1", "password": "mpJla03Uku2WeT4apBOzixQN" }
      ],
      "masquerade": "https://www.bing.com",
      "tls": {
        "enabled": true,
        "certificate_path": "/etc/sing-box/cert.pem",
        "key_path": "/etc/sing-box/key.pem"
      }
    },
    {
      "type": "tuic",
      "tag": "tuic-in",
      "listen": "::",
      "listen_port": 8443,
      "users": [
        { "uuid": "26e41aee-275e-47d8-9f4f-464382e53d5d", "password": "TUvGGssIEJ0AQPRRNccTliuh" }
      ],
      "congestion_control": "bbr",
      "tls": {
        "enabled": true,
        "alpn": ["h3"],
        "certificate_path": "/etc/sing-box/cert.pem",
        "key_path": "/etc/sing-box/key.pem"
      }
    }
  ],
  "outbounds": [ { "type": "direct" } ]
}
EOC

cat > /etc/systemd/system/sing-box.service <<'EOS'
[Unit]
Description=sing-box
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/sing-box run -c /etc/sing-box/config.json
Restart=on-failure
RestartSec=5
LimitNOFILE=infinity

[Install]
WantedBy=multi-user.target
EOS

systemctl daemon-reload
systemctl enable sing-box
systemctl restart sing-box

echo 'net.core.default_qdisc=fq' >> /etc/sysctl.conf
echo 'net.ipv4.tcp_congestion_control=bbr' >> /etc/sysctl.conf
sysctl -p

# --- 流量计数：hy2(443) + tuic(8443) 的入/出字节数 ---
iptables -N VPN-IN  2>/dev/null || true
iptables -N VPN-OUT 2>/dev/null || true
iptables -F VPN-IN
iptables -F VPN-OUT
iptables -A VPN-IN  -p udp --dport 443  -j RETURN
iptables -A VPN-IN  -p udp --dport 8443 -j RETURN
iptables -A VPN-OUT -p udp --sport 443  -j RETURN
iptables -A VPN-OUT -p udp --sport 8443 -j RETURN
iptables -C INPUT  -j VPN-IN  2>/dev/null || iptables -I INPUT  -j VPN-IN
iptables -C OUTPUT -j VPN-OUT 2>/dev/null || iptables -I OUTPUT -j VPN-OUT

echo "VPN SETUP DONE"

mkdir -p /var/www/sub
cat > /var/www/sub/sub-736079d1.yaml <<'EOSUB'
# GCP vpn-node (35.212.220.175, us-west1) — Clash Verge / mihomo 配置
proxies:
  - name: GCP-hy2
    type: hysteria2
    server: 35.212.220.175
    port: 443
    password: mpJla03Uku2WeT4apBOzixQN
    sni: www.bing.com
    skip-cert-verify: true

  - name: GCP-tuic
    type: tuic
    server: 35.212.220.175
    port: 8443
    uuid: 26e41aee-275e-47d8-9f4f-464382e53d5d
    password: TUvGGssIEJ0AQPRRNccTliuh
    congestion-controller: bbr
    sni: www.bing.com
    skip-cert-verify: true

proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - GCP-hy2
      - GCP-tuic
      - DIRECT

rules:
  - GEOSITE,private,DIRECT
  - GEOSITE,cn,DIRECT
  - GEOIP,private,DIRECT,no-resolve
  - GEOIP,CN,DIRECT
  - MATCH,节点选择
EOSUB

# --- 订阅服务：带 Subscription-Userinfo 流量信息头 ---
mkdir -p /etc/vpn
cat > /usr/local/bin/sub-server.py <<'EOPY'
#!/usr/bin/env python3
import json, os, subprocess, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

SUB_PATH = "/sub-736079d1.yaml"
YAML_FILE = "/var/www/sub/sub-736079d1.yaml"
STATE_FILE = "/etc/vpn/traffic.json"
TOTAL = 200 * 1024 ** 3  # Standard 层级每月 200GB 免费出站流量

def read_counters():
    up = down = 0
    for chain in ("VPN-IN", "VPN-OUT"):
        try:
            r = subprocess.run(["iptables", "-L", chain, "-v", "-x", "-n"],
                               capture_output=True, text=True)
            for line in r.stdout.splitlines():
                f = line.split()
                if len(f) >= 2 and f[0].isdigit():
                    if chain == "VPN-IN":
                        up += int(f[1])
                    else:
                        down += int(f[1])
        except Exception:
            pass
    return up, down

def get_traffic():
    now = datetime.datetime.now(datetime.timezone.utc)
    month = now.strftime("%Y-%m")
    up, down = read_counters()
    st = {"month": month, "base_up": 0, "base_down": 0, "last_up": 0, "last_down": 0}
    try:
        with open(STATE_FILE) as fh:
            st.update(json.load(fh))
    except Exception:
        pass
    if st.get("month") != month:  # 跨月清零重新计
        st = {"month": month, "base_up": 0, "base_down": 0, "last_up": 0, "last_down": 0}
    if up < st["last_up"]:        # 计数器归零（实例重启）=> 把旧值并入基数
        st["base_up"] += st["last_up"]
    if down < st["last_down"]:
        st["base_down"] += st["last_down"]
    st["last_up"], st["last_down"] = up, down
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE, "w") as fh:
            json.dump(st, fh)
    except Exception:
        pass
    return st["base_up"] + up, st["base_down"] + down

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] != SUB_PATH:
            self.send_response(404)
            self.end_headers()
            return
        up, down = get_traffic()
        now = datetime.datetime.now(datetime.timezone.utc)
        if now.month == 12:
            nxt = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0)
        else:
            nxt = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0)
        # 动态注入"信息节点"（仿机场做法）：节点名显示剩余流量和重置日
        with open(YAML_FILE, "r", encoding="utf-8") as fh:
            text = fh.read()
        remaining = max(TOTAL - up - down, 0) / 1024 ** 3
        reset_day = nxt.strftime("%Y-%m-%d")
        info_nodes = (
            '  - name: "剩余流量：%.2f GB"\n'
            '    type: ss\n'
            '    server: 127.0.0.1\n'
            '    port: 10000\n'
            '    cipher: aes-128-gcm\n'
            '    password: "info"\n'
            '  - name: "流量重置：%s"\n'
            '    type: ss\n'
            '    server: 127.0.0.1\n'
            '    port: 10000\n'
            '    cipher: aes-128-gcm\n'
            '    password: "info"\n'
        ) % (remaining, reset_day)
        text = text.replace("proxies:\n", "proxies:\n" + info_nodes, 1)
        grp = ('      - "剩余流量：%.2f GB"\n'
               '      - "流量重置：%s"\n') % (remaining, reset_day)
        text = text.replace("      - GCP-hy2\n", grp + "      - GCP-hy2\n", 1)
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/yaml; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Subscription-Userinfo",
                         "upload=%d; download=%d; total=%d; expire=%d"
                         % (up, down, TOTAL, int(nxt.timestamp())))
        self.send_header("Profile-Update-Interval", "24")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

HTTPServer(("0.0.0.0", 80), Handler).serve_forever()
EOPY

cat > /etc/systemd/system/sub-serve.service <<'EOSVC'
[Unit]
Description=subscription http server
After=network.target

[Service]
ExecStart=/usr/bin/python3 /usr/local/bin/sub-server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOSVC

systemctl daemon-reload
systemctl enable sub-serve
systemctl restart sub-serve

# --- 配置版本管理：/etc/vpn/repo 下 git 仓库，每次开机自动提交 ---
mkdir -p /etc/vpn/repo
cp /etc/sing-box/config.json /etc/vpn/repo/sing-box-config.json
cp /var/www/sub/sub-736079d1.yaml /etc/vpn/repo/sub-736079d1.yaml
cp /usr/local/bin/sub-server.py /etc/vpn/repo/sub-server.py
cd /etc/vpn/repo
if [ ! -d .git ]; then
  git init -q
  git config user.email "vpn-node@local"
  git config user.name "vpn-node"
fi
git add -A
git diff --cached --quiet || git commit -q -m "boot $(date -Iseconds)"

echo "ALL DONE"
