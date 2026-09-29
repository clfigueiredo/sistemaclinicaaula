# Setup do ambiente local (Windows 11)

## Já instalado (verificado em 29/09/2026)

- Node v24.14.0 / npm 11.9.0
- Git 2.53
- winget 1.29
- WSL com versão padrão 2

- **Docker Desktop instalado e testado** (29/09/2026): Docker 29.8.1, Compose v5.5.1, `hello-world` OK
  - Instalação **por usuário** em `C:\Users\clffi\AppData\Local\Programs\DockerDesktop`
  - CLI em `...\DockerDesktop\resources\bin` — já está no PATH do usuário (confirmado). Terminais abertos antes da instalação precisam ser reabertos.
- Portas livres: 5432 (Postgres), 6379 (Redis), 21465 (WPPConnect), 3333 (API), 5173 (Web/Vite)

## Instalar o Docker Desktop

### Opção A — instalador

1. Baixar em <https://www.docker.com/products/docker-desktop/> (Windows – AMD64).
2. Executar o instalador e manter marcada a opção **"Use WSL 2 instead of Hyper-V"**.
3. Reiniciar o computador quando pedir.
4. Abrir o Docker Desktop, aceitar os termos (não precisa criar conta — pode clicar em *Skip*).
5. Esperar o ícone da baleia ficar verde ("Engine running").

### Opção B — pelo terminal (PowerShell como administrador)

```powershell
winget install -e --id Docker.DockerDesktop
```

Depois reiniciar o computador e abrir o Docker Desktop uma vez.

### Se aparecer erro de WSL

```powershell
wsl --install          # como administrador, depois reiniciar
wsl --update
```

Se reclamar de virtualização: entrar na BIOS e habilitar **Intel VT-x** / **AMD-V (SVM)**.

## Testar

```powershell
docker --version
docker compose version
docker run --rm hello-world
```

Se o `hello-world` imprimir "Hello from Docker!", está tudo pronto.
