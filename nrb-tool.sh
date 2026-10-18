#!/bin/bash
set -e
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo bash nrb-tool.sh"; exit 1; fi
while true; do
  clear
  echo "LVM TOOLS - LXD"
  echo "1. Start LVM Panel"
  echo "2. Install / initialize LXD"
  echo "3. LXD status and instances"
  echo "0. Exit"
  read -r -p 'Choose [0-3]: ' choice
  case "$choice" in
    1) bash start.sh ;;
    2) bash install.sh ;;
    3) lxc info; lxc list ;;
    0) exit 0 ;;
    *) echo "Invalid option" ;;
  esac
  read -r -p 'Press Enter to continue...' _
done
