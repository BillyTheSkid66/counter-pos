# SCALAHOSTING VPS — MASTER INFRASTRUCTURE PROFILE

**Version:** 1.1  
**Updated:** 28 October 2026  
**Provider:** ScalaHosting  
**Environment:** Managed VPS with SPanel  
**Purpose:** Reference for AI-assisted software development, deployment and infrastructure compatibility.

**Important:** This profile describes the server's last verified state. Some software upgrades and configuration checks have been requested or are planned but are not yet confirmed as completed.

---

## 1. Server Hardware

| Component | Specification |
|---|---|
| VPS | ScalaHosting Managed VPS |
| CPU | 2 vCPU |
| CPU architecture | x86-64 |
| CPU vendor | Intel (reported as GenuineIntel) |
| RAM allocation | 2 GB advertised |
| RAM visible to Linux | Approximately 1.7 GiB |
| Swap | 2 GiB |
| Storage | 50 GB |
| Used storage | Approximately 19 GB at audit |
| Available storage | Approximately 31 GB at audit |
| Storage type | Unverified |
| GPU | Unverified; do not assume availability |
| Network bandwidth quota | Unverified |

### Resource observations

Recent monitoring showed:

- Approximately 670–701 MiB available RAM.
- Approximately 890 MiB swap occupied.
- No sustained swap activity observed during short sampling.
- Repeated CPU usage around 75–80%.
- Approximately 50–60% system/kernel CPU usage.
- Load averages approaching 2 on the two-core server.
- Existing Node.js applications reporting low individual CPU usage.

**Status:** Elevated system CPU utilisation remains under investigation.

The VPS should be considered resource-constrained until additional capacity has been verified.

Avoid unnecessarily heavy applications, local language models, large background workloads and resource-intensive production builds.

---

## 2. Operating System

| Component | Configuration |
|---|---|
| OS | Rocky Linux 9.8 (Blue Onyx) |
| OS family | Enterprise Linux / RHEL 9 |
| Kernel | 5.14.0-687.30.1.el9_8.x86_64 |
| Architecture | x86-64 |
| Service manager | systemd |
| Package manager | DNF |
| System-reported OS support end | 31 May 2032 |
| Server timezone | Europe/London |

The operating system is managed through ScalaHosting and SPanel.

Avoid changing system packages, default interpreters or privileged services without approval.

---

## 3. Hosting Accounts

The VPS currently contains **five SPanel hosting accounts**.

Two accounts have confirmed Node.js applications:

- `ggadmin` — three Node.js applications.
- `bexboss` — Bex Vapes stock application.

Other hosting accounts have not been individually audited.

### Account isolation

- Hosting accounts have separate application environments.
- SSH users may have restricted permissions.
- Processes belonging to other accounts are not necessarily visible.
- Each account may have its own application-management context.
- Shared runtime availability must be confirmed separately for each account.

The SSH account audited was `ggadmin`, a non-root user belonging to the `spanelusers` group.

### SSH restrictions

- SSH access is available.
- Bash is available.
- `sudo` is installed.
- Passwordless sudo is unavailable.
- Password-authenticated sudo permissions have not been established.
- System package installation through DNF requires elevated privileges.
- Root SSH access has not been confirmed.

The server has:

`hidepid=invisible`

configured on `/proc`, restricting process visibility.

AI assistants must not assume that a standard SSH user can view or control every server process.

---

## 4. Node.js Development Environment

| Software | Version |
|---|---|
| Node.js | 24.18.1 |
| npm | 11.16.0 |
| PM2 | 7.1.0 |
| Git | 2.52.0 |
| Node executable | `/usr/bin/node` |
| npm executable | `/usr/bin/npm` |

Node.js 24 is the current recommended runtime for compatible new applications.

### Deployment capabilities

- SPanel includes a NodeJS Manager.
- Applications can be deployed and managed through SPanel.
- SPanel exposes application status, CPU, memory, port and running time.
- Application actions include Restart, Stop, Edit, View Logs and Undeploy.
- PM2 is available for Node.js process management.
- Multiple Node.js applications already operate on the VPS.

### Limitations

- PM2 reboot recovery has not been verified.
- No standard `pm2-ggadmin.service` was found.
- SPanel may have its own startup mechanism.
- Existing applications have no configured PM2 memory-restart thresholds.
- Docker is not available through the audited SSH PATH.

Do not create or modify systemd services unless ScalaHosting confirms the supported deployment method.

---

## 5. Existing Node.js Applications

**Four applications confirmed online during the latest SPanel audit.**

| Application | Account | Port | Last reported memory |
|---|---|---|---|
| Portworks | ggadmin | 3000 | 19 MB |
| Pace | ggadmin | 3148 | 17 MB |
| Counter API | ggadmin | 3134 | 17 MB |
| Bex Vapes Stock | bexboss | 3100 | 23 MB |

### Application URLs

- Portworks: `https://portworks.app-playground.co.uk/`
- Pace: `https://pace.app-playground.co.uk/`
- Counter API: `https://counter-api.app-playground.co.uk/`
- Bex Vapes Stock: `https://stock.bexvapes.co.uk/`

### Additional findings

Portworks uses Next.js 16.3.5.

Identified process commands:

- Counter API: `node spanel-entry.js`
- Pace: `node server/server.cjs`
- Portworks: Next.js server

The three applications under `ggadmin` were also confirmed in PM2, using fork mode with zero recorded restarts.

Automatic crash restart is configured in their saved PM2 process definitions.

**All four ports are reserved and must not be reused by new projects.**

---

## 6. PHP Environment

| Component | Configuration |
|---|---|
| SPanel default PHP | 8.5 |
| Hosted website PHP | 8.5 selected individually |
| SSH command-line PHP | 8.1.34 |
| PHP CLI path | `/usr/bin/php` |
| Composer | Installed |
| ionCube PHP Loader (CLI) | 15.5.1 |
| Zend OPcache (CLI) | 8.1.34 |

### Important distinction

PHP 8.5 was selected through SPanel for individual websites and as the SPanel default.

The SSH command-line PHP remains 8.1.34.

AI development projects must not assume website PHP and CLI PHP are identical.

PHP compatibility, extensions and Composer runtime requirements should be checked before deployment.

Do not change PHP globally without confirming dependencies.

---

## 7. Python Environment

### Currently verified

| Component | Status |
|---|---|
| Python | 3.9.25 |
| Executable | `/usr/bin/python3` |
| pip for Python 3.9 | Not available |
| Built-in venv module | Help command works; environment creation untested |
| Python 3.14 | Not installed in audited PATH |
| uv | Not found |
| pipx | Not found |
| virtualenv command | Not found |
| Gunicorn | Not found |
| Uvicorn | Not found |

### Pending upgrade

**Python 3.14 installation is pending ScalaHosting support.**

Python 3.14.8 was found in the configured Rocky Linux AppStream repository.

The desired configuration is:

- Python 3.14 installed centrally.
- Available to all five SPanel accounts.
- Matching pip support.
- Working virtual environments.
- Existing system Python 3.9 preserved.
- Independent dependencies per application.

Do not assume Python 3.14 is operational until the installation and per-account access have been verified.

---

## 8. Database and Caching Environment

| Technology | Status |
|---|---|
| MariaDB | Server 11.8.9 active |
| PostgreSQL | Server 18 active |
| SQLite | CLI version 3.34.1 available |
| Memcached | Active |
| Redis | Executables installed; standard service inactive |

### Database ports

| Port | Service | Binding |
|---|---|---|
| 3306 | MariaDB | 0.0.0.0 |
| 5432 | PostgreSQL | 127.0.0.1 |
| 11211 | Memcached | 127.0.0.1 |
| 6379 | Redis | No listener confirmed |

### Database recommendations

Use existing MariaDB or PostgreSQL services where appropriate.

SQLite may be considered for smaller standalone applications.

Avoid enabling additional persistent database or caching services unless justified.

Each new project should have isolated database credentials and the minimum necessary permissions.

Database user privileges, connection limits and per-account management capabilities remain unverified.

---

## 9. Networking and Web Hosting

### Web infrastructure

- Apache web server is active.
- HTTP port 80 is listening.
- HTTPS port 443 is listening.
- Outbound HTTPS to an external test endpoint succeeded.
- BIND DNS server is active.
- FTP and email-related services are running.
- SPanel manages domains and web applications.

### Node.js port allocation

| Port | Application | Binding |
|---|---|---|
| 3000 | Portworks | 127.0.0.1 |
| 3100 | Bex Vapes Stock | 127.0.0.1 |
| 3134 | Counter API | 0.0.0.0 |
| 3148 | Pace | 127.0.0.1 |

Ports 3000, 3100, 3134 and 3148 are reserved.

### Networking rules

- Prefer localhost bindings for internal application services.
- Use HTTPS for publicly accessible applications.
- Verify SPanel's domain routing and proxy configuration.
- Assign unique application ports.
- Do not expose development or database services publicly without approval.
- Do not assume outbound access to every external service.

Port 3134 and MariaDB port 3306 require external-access verification.

---

## 10. Firewall and Security

| Security component | Status |
|---|---|
| CSF | Installed |
| LFD | Active |
| FirewallD | Inactive |
| nftables service | Inactive |
| iptables service | Inactive |
| Effective firewall rules | Not verified |
| SPanel login CAPTCHA | Google reCAPTCHA |
| SPanel 2FA | Disabled at last inspection |
| Google login | Enabled |
| GitHub login | Enabled |
| Passkey login | Enabled |

The standard SSH account cannot inspect CSF configuration due to permission restrictions.

LFD being active does not independently establish which firewall rules are enforced.

### Security principles

- Do not weaken existing firewall or process-isolation controls.
- Keep credentials outside source code.
- Separate project databases and secrets.
- Require appropriate authentication for administrative dashboards.
- Use HTTPS and secure session management.
- Confirm firewall changes with ScalaHosting.
- Enable and verify administrative multifactor authentication where appropriate.

---

## 11. Other Confirmed Server Services

The following services have been observed running:

- Apache Web Server
- Exim Email Server
- Dovecot POP3/IMAP
- Pure-FTPd
- BIND DNS
- SpamAssassin
- MariaDB
- PostgreSQL
- Cron Jobs Daemon
- Memcached
- PHP-FPM

Cron is available. The audited `ggadmin` user crontab showed only an empty `MAILTO` setting and no scheduled jobs.

This does not rule out system-level or other-account scheduled jobs.

---

## 12. Development Standards for New Projects

Unless a project has a justified reason to differ, use the following principles.

### Architecture

- Prefer lightweight Node.js applications.
- Use Node.js 24 when compatible.
- Reuse the existing MariaDB or PostgreSQL infrastructure.
- Avoid unnecessary microservices.
- Minimise persistent background processes.
- Use external AI APIs rather than hosting large AI models locally.
- Design applications to be portable to larger hosting infrastructure.

### Application isolation

Each project should have:

- Its own application directory.
- A dedicated Git repository.
- Separate environment variables.
- Independent credentials.
- Its own database or schema where appropriate.
- A unique internal port if needed.
- Its own application logs.
- Documented startup commands.
- A deployment and rollback procedure.

### Resource management

- Assess expected CPU and memory usage.
- Avoid expensive build processes during busy periods.
- Limit unnecessary background polling.
- Avoid introducing large resource-intensive dependencies.
- Monitor application performance.
- Consider existing workloads before adding persistent services.

### Deployment

Use SPanel's NodeJS Manager when suitable.

Do not assume the same permissions or capabilities exist across all five hosting accounts.

Do not restart, stop or modify existing applications without explicit approval.

---

## 13. Outstanding Infrastructure Checks

### Awaiting ScalaHosting

1. Install Python 3.14 for all five accounts.
2. Verify pip and virtual-environment support.
3. Investigate elevated system/kernel CPU utilisation.
4. Verify automatic recovery of all four Node.js applications after a VPS reboot.
5. Confirm firewall restrictions for ports 3134 and 3306.
6. Recommend safe resource optimisations.

### Additional verification required

- Confirm PHP 8.5 compatibility across all sites.
- Confirm database privileges per account.
- Verify reverse-proxy and HTTPS configuration.
- Establish Git deployment procedures.
- Check resource usage during application builds.
- Confirm security and authentication settings.
- Verify Python application-hosting support following installation.

---

## 14. Backup and Recovery

**Backup investigation intentionally deferred by the server owner.**

Last observed SPanel configuration:

- Local backups enabled.
- Monthly schedule on the 14th.
- Retention of one monthly backup.
- Hourly, daily and weekly backups disabled.
- Remote backups disabled.
- No restore points displayed.
- Provider-managed backups unverified.

**Important:** Do not assume that a reliable restore point exists.

Production database changes, destructive operations or deployments requiring rollback must have an appropriate verified recovery method.

---

## 15. Instructions for AI Development Projects

You are developing an application intended to run on this existing ScalaHosting VPS.

Use this document as the infrastructure reference.

Before suggesting or implementing an architecture:

1. Identify the target SPanel hosting account.
2. Confirm the required runtime is actually available.
3. Review existing applications and reserved ports.
4. Assess expected CPU, memory and disk requirements.
5. Prefer existing server services.
6. Do not assume administrator or root permissions.
7. Avoid interfering with existing applications.
8. Separate credentials and application data.
9. Highlight any software or infrastructure dependencies that are missing.
10. Explain whether ScalaHosting assistance is required.
11. Provide deployment instructions appropriate to SPanel.
12. Document application startup, monitoring and recovery.
13. Seek approval before changing shared services or production configurations.
14. Do not assume backups or automatic reboot recovery are working until verified.

When designing commercial applications, also account for authentication, separate customer data, data protection, application monitoring and growth beyond the current VPS capacity.

**Primary objective:** Develop efficient, secure, maintainable applications that run within existing VPS capabilities, minimise unnecessary costs and remain portable to larger infrastructure if the business grows.

---

**End of Master Infrastructure Profile — Version 1.1**