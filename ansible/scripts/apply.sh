#!/usr/bin/env bash
#
# apply.sh — apply site.yml to the server from this machine
#
# Extra args are passed to ansible-playbook. The host's address isn't in the
# repo: it comes from a `Host rawi` entry (HostName <ip>) in ~/.ssh/config.
# Secrets are in host_vars/rawi/vault.yml, opened with the password in
# ~/.config/rawi/vault-pass (see ansible.cfg); edit them with
# `ansible-vault edit host_vars/rawi/vault.yml`.
#
# Usage:
#   ./ansible/scripts/apply.sh                  # apply
#   ./ansible/scripts/apply.sh --check --diff   # dry run
#
# Bootstrap (before the ansible user exists), as an admin user instead:
#   ./ansible/scripts/apply.sh -e ansible_user=basel -e ansible_ssh_private_key_file=~/.ssh/id_ed25519
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ansible-galaxy collection install -r requirements.yml
exec ansible-playbook site.yml "$@"
