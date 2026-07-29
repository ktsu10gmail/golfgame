#!/usr/bin/env bash
set -Eeuo pipefail

###############################################################################
# install-ai-platform-v4.sh
# Ubuntu 22.04 / 24.04 AI Platform Installer
#
# Includes:
# - System update and base utilities
# - Docker CE + Docker Compose plugin using Docker official repo
# - Optional NVIDIA driver install if NVIDIA GPU is detected
# - NVIDIA Container Toolkit using current stable/deb repo path
# - PostgreSQL, Redis, Nginx
# - Ollama
# - XFCE + XRDP
# - VS Code
# - Google Chrome
# - Optional Open WebUI container
# - Firewall rules
###############################################################################

LOG_FILE="/var/log/install-ai-platform.log"
exec > >(tee -a "$LOG_FILE") 2>&1

trap 'echo "[ERROR] Installation failed on line $LINENO with exit code $?. Check log: $LOG_FILE"' ERR

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

require_root() {
    if [[ "${EUID}" -ne 0 ]]; then
        echo "Please run as root: sudo $0"
        exit 1
    fi
}

run_apt_update() {
    apt update
}

install_packages() {
    DEBIAN_FRONTEND=noninteractive apt install -y "$@"
}

enable_start_service() {
    local svc="$1"
    systemctl enable "$svc" || true
    systemctl start "$svc" || true
}

###############################################################################
# User-configurable options
###############################################################################
INSTALL_NVIDIA_DRIVER=true
INSTALL_NVIDIA_TOOLKIT=true
INSTALL_POSTGRESQL=true
INSTALL_REDIS=true
INSTALL_NGINX=true
INSTALL_OLLAMA=true
INSTALL_XFCE_XRDP=true
INSTALL_VSCODE=true
INSTALL_CHROME=true
INSTALL_OPEN_WEBUI=true
CONFIGURE_FIREWALL=true
CONFIGURE_NFS=false

NFS_SERVER_PATH="192.168.1.163:/Nfs-Storage"
NFS_MOUNT_POINT="/mnt/nas"

OPEN_WEBUI_PORT="3000"
OLLAMA_PORT="11434"

###############################################################################
# Start
###############################################################################
require_root

log "Starting install-ai-platform-v4.sh"
log "Log file: $LOG_FILE"
log "Detected OS: $(. /etc/os-release && echo "$PRETTY_NAME")"

if [[ -n "${SUDO_USER:-}" ]]; then
    TARGET_USER="$SUDO_USER"
else
    TARGET_USER="$(logname 2>/dev/null || echo root)"
fi
log "Target non-root user: $TARGET_USER"

###############################################################################
# 1. System update
###############################################################################
log "[1/17] Updating system packages..."
run_apt_update
DEBIAN_FRONTEND=noninteractive apt upgrade -y

###############################################################################
# 2. Base utilities
###############################################################################
log "[2/17] Installing base utilities..."
install_packages \
    curl wget git unzip ca-certificates gnupg lsb-release \
    software-properties-common apt-transport-https \
    pciutils ubuntu-drivers-common ufw dos2unix nfs-common \
    jq nano vim htop net-tools openssh-server alsa-utils

###############################################################################
# 3. Docker official repo + Docker CE
###############################################################################
log "[3/17] Installing Docker CE and Docker Compose plugin..."
install -m 0755 -d /etc/apt/keyrings
rm -f /etc/apt/keyrings/docker.gpg /etc/apt/sources.list.d/docker.list

curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release
DOCKER_CODENAME="${VERSION_CODENAME}"

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${DOCKER_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

run_apt_update
install_packages docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

enable_start_service docker

if [[ "$TARGET_USER" != "root" ]]; then
    usermod -aG docker "$TARGET_USER" || true
fi

###############################################################################
# 4. NVIDIA GPU detection
###############################################################################
log "[4/17] Detecting NVIDIA GPU..."
NVIDIA_DETECTED=false
if lspci | grep -qi nvidia; then
    NVIDIA_DETECTED=true
    log "NVIDIA GPU detected:"
    lspci | grep -i nvidia || true
else
    log "No NVIDIA GPU detected. NVIDIA driver/toolkit sections will be skipped."
fi

###############################################################################
# 5. NVIDIA driver
###############################################################################
if [[ "$INSTALL_NVIDIA_DRIVER" == "true" && "$NVIDIA_DETECTED" == "true" ]]; then
    log "[5/17] Installing NVIDIA driver with ubuntu-drivers autoinstall..."
    ubuntu-drivers devices || true
    DEBIAN_FRONTEND=noninteractive ubuntu-drivers autoinstall || {
        log "WARNING: ubuntu-drivers autoinstall failed. Continuing so other components can install."
    }
else
    log "[5/17] Skipping NVIDIA driver install."
fi

###############################################################################
# 6. NVIDIA Container Toolkit - FIXED v4 repo path
###############################################################################
if [[ "$INSTALL_NVIDIA_TOOLKIT" == "true" && "$NVIDIA_DETECTED" == "true" ]]; then
    log "[6/17] Installing NVIDIA Container Toolkit using stable/deb repo..."

    rm -f /etc/apt/sources.list.d/nvidia-container-toolkit.list
    rm -f /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
        gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

    curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null

    run_apt_update
    install_packages nvidia-container-toolkit

    nvidia-ctk runtime configure --runtime=docker
    systemctl restart docker
else
    log "[6/17] Skipping NVIDIA Container Toolkit install."
fi

###############################################################################
# 7. PostgreSQL
###############################################################################
if [[ "$INSTALL_POSTGRESQL" == "true" ]]; then
    log "[7/17] Installing PostgreSQL..."
    install_packages postgresql postgresql-contrib
    enable_start_service postgresql
else
    log "[7/17] Skipping PostgreSQL."
fi

###############################################################################
# 8. Redis
###############################################################################
if [[ "$INSTALL_REDIS" == "true" ]]; then
    log "[8/17] Installing Redis..."
    install_packages redis-server
    enable_start_service redis-server
else
    log "[8/17] Skipping Redis."
fi

###############################################################################
# 9. Nginx
###############################################################################
if [[ "$INSTALL_NGINX" == "true" ]]; then
    log "[9/17] Installing Nginx..."
    install_packages nginx
    enable_start_service nginx
else
    log "[9/17] Skipping Nginx."
fi

###############################################################################
# 10. Ollama
###############################################################################
if [[ "$INSTALL_OLLAMA" == "true" ]]; then
    log "[10/17] Installing Ollama..."
    if ! command -v ollama >/dev/null 2>&1; then
        curl -fsSL https://ollama.com/install.sh | sh
    else
        log "Ollama already installed."
    fi
    systemctl enable ollama || true
    systemctl start ollama || true
else
    log "[10/17] Skipping Ollama."
fi

###############################################################################
# 11. XFCE + XRDP
###############################################################################
if [[ "$INSTALL_XFCE_XRDP" == "true" ]]; then
    log "[11/17] Installing XFCE desktop and XRDP..."
    DEBIAN_FRONTEND=noninteractive install_packages xfce4 xfce4-goodies xrdp dbus-x11

    if [[ "$TARGET_USER" != "root" ]]; then
        TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
        echo "xfce4-session" > "$TARGET_HOME/.xsession"
        chown "$TARGET_USER:$TARGET_USER" "$TARGET_HOME/.xsession" || true
    fi

    adduser xrdp ssl-cert || true
    systemctl enable xrdp || true
    systemctl restart xrdp || true
else
    log "[11/17] Skipping XFCE/XRDP."
fi

###############################################################################
# 12. VS Code
###############################################################################
if [[ "$INSTALL_VSCODE" == "true" ]]; then
    log "[12/17] Installing Visual Studio Code..."
    rm -f /etc/apt/sources.list.d/vscode.list
    rm -f /usr/share/keyrings/packages.microsoft.gpg

    wget -qO- https://packages.microsoft.com/keys/microsoft.asc | \
        gpg --dearmor -o /usr/share/keyrings/packages.microsoft.gpg

    echo "deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" \
        > /etc/apt/sources.list.d/vscode.list

    run_apt_update
    install_packages code
else
    log "[12/17] Skipping VS Code."
fi

###############################################################################
# 13. Google Chrome
###############################################################################
if [[ "$INSTALL_CHROME" == "true" ]]; then
    log "[13/17] Installing Google Chrome..."
    rm -f /etc/apt/sources.list.d/google-chrome.list
    rm -f /usr/share/keyrings/google-chrome.gpg

    wget -qO- https://dl.google.com/linux/linux_signing_key.pub | \
        gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg

    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list

    run_apt_update
    install_packages google-chrome-stable
else
    log "[13/17] Skipping Google Chrome."
fi

###############################################################################
# 14. Optional NFS mount
###############################################################################
if [[ "$CONFIGURE_NFS" == "true" ]]; then
    log "[14/17] Configuring NFS mount..."
    mkdir -p "$NFS_MOUNT_POINT"
    if ! grep -q "$NFS_SERVER_PATH" /etc/fstab; then
        echo "$NFS_SERVER_PATH $NFS_MOUNT_POINT nfs defaults,_netdev,nofail 0 0" >> /etc/fstab
    fi
    mount -a || true
else
    log "[14/17] Skipping NFS configuration."
fi

###############################################################################
# 15. Open WebUI container
###############################################################################
if [[ "$INSTALL_OPEN_WEBUI" == "true" ]]; then
    log "[15/17] Installing/Open WebUI Docker container..."
    if docker ps -a --format '{{.Names}}' | grep -qx open-webui; then
        log "open-webui container already exists. Starting it..."
        docker start open-webui || true
    else
        docker run -d \
            --name open-webui \
            -p "${OPEN_WEBUI_PORT}:8080" \
            --restart unless-stopped \
            -v open-webui:/app/backend/data \
            ghcr.io/open-webui/open-webui:main || {
                log "WARNING: Open WebUI container failed to start. Continuing."
            }
    fi
else
    log "[15/17] Skipping Open WebUI."
fi

###############################################################################
# 16. Firewall
###############################################################################
if [[ "$CONFIGURE_FIREWALL" == "true" ]]; then
    log "[16/17] Configuring UFW firewall rules..."
    ufw allow OpenSSH || true
    ufw allow 22/tcp || true
    ufw allow 80/tcp || true
    ufw allow 443/tcp || true
    ufw allow 3389/tcp || true
    ufw allow "${OPEN_WEBUI_PORT}/tcp" || true
    ufw allow 8000/tcp || true
    ufw allow 3001/tcp || true
    ufw allow 9090/tcp || true
    ufw allow "${OLLAMA_PORT}/tcp" || true
    ufw --force enable || true
else
    log "[16/17] Skipping firewall configuration."
fi

###############################################################################
# 17. Validation summary
###############################################################################
log "[17/17] Validation summary..."

echo "================================================"
echo " INSTALLATION SUMMARY"
echo "================================================"

echo "OS:"
. /etc/os-release && echo "$PRETTY_NAME"

echo ""
echo "Kernel:"
uname -r || true

echo ""
echo "Docker:"
docker --version || true

echo ""
echo "Docker Compose:"
docker compose version || true

echo ""
echo "NVIDIA Driver:"
nvidia-smi || true

echo ""
echo "NVIDIA Container Toolkit:"
nvidia-ctk --version || true

echo ""
echo "PostgreSQL:"
systemctl is-active postgresql || true
psql --version || true

echo ""
echo "Redis:"
systemctl is-active redis-server || true
redis-cli ping || true

echo ""
echo "Nginx:"
systemctl is-active nginx || true
nginx -v || true

echo ""
echo "Ollama:"
ollama --version || true
systemctl is-active ollama || true

echo ""
echo "XRDP:"
systemctl is-active xrdp || true

echo ""
echo "VS Code:"
code --version || true

echo ""
echo "Google Chrome:"
google-chrome --version || true

echo ""
echo "Open WebUI:"
docker ps --filter name=open-webui --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true

echo ""
echo "Firewall:"
ufw status || true

echo "================================================"
echo "NEXT STEPS"
echo "================================================"
echo "1. Reboot is strongly recommended if a kernel or NVIDIA driver was installed:"
echo "   sudo reboot"
echo ""
echo "2. After reboot, test Docker GPU support:"
echo "   docker run --rm --gpus all nvidia/cuda:12.3.0-base-ubuntu22.04 nvidia-smi"
echo ""
echo "3. Open WebUI URL:"
echo "   http://<server-ip>:${OPEN_WEBUI_PORT}"
echo ""
echo "4. Ollama API URL:"
echo "   http://<server-ip>:${OLLAMA_PORT}"
echo ""
echo "5. XRDP:"
echo "   mstsc.exe -> <server-ip>:3389"
echo "================================================"

log "install-ai-platform-v4.sh completed."
