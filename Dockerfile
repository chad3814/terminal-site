# terminal-site — four browser terminals into *this container's* shells.
#
# The container is the machine. The panes are not your host shell: no dotfiles,
# no host tools, and the tmux sessions live and die with the container. Anything
# you want to keep must be on a volume — see docker-compose.yaml.
#
# Deliberately a single stage. The usual reason to split is to keep a compiler
# out of the runtime image, but this image *is* a dev box: build-essential is
# wanted in the shells, so a builder stage would only duplicate it.
#
# Debian, not Alpine. node-pty ships no Linux prebuilds (only darwin-* and
# win32-*), so it compiles from source here, and glibc is the path with fewer
# surprises than musl for a native addon.
FROM node:22-bookworm-slim

# - build-essential, python3: node-pty compiles at install time, and they are
#   wanted in the shells anyway.
# - tmux: a hard runtime dependency. Without it every pane reports
#   "tmux not found on PATH" and no shell ever starts.
# - zsh: the shell the panes get, matching the host workflow.
# - the rest: the bare minimum for the container to be usable as a dev box.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      less \
      procps \
      python3 \
      tmux \
      zsh \
 && rm -rf /var/lib/apt/lists/*

# UTF-8 end to end. Without this the shell and tmux run in the POSIX locale and
# mangle the box-drawing and multibyte characters the terminal renders — the
# pane title format itself contains a U+00B7.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# The panes run as whoever this process runs as. `node` (uid 1000, ships with
# the base image) rather than root, so files written to the /work bind mount
# land as uid 1000 instead of being root-owned on the host.
#
# Be clear about what this is NOT: passwordless sudo is granted below, because
# the container is meant to be a usable dev box. Anyone who reaches a pane is
# therefore root-equivalent *inside the container* one word away. Running as
# `node` is a convenience for host file ownership, not a security boundary —
# the container itself is the boundary. Remove the sudoers line if you want
# that to stop being true, and use `docker exec -u 0 terminal-site ...` instead.
RUN apt-get update \
 && apt-get install -y --no-install-recommends sudo \
 && rm -rf /var/lib/apt/lists/* \
 && echo 'node ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/node \
 && chmod 0440 /etc/sudoers.d/node \
 && chsh -s /usr/bin/zsh node

# Seed a .zshrc, or zsh runs zsh-newuser-install in every pane.
#
# Found by running it: with no ~/.zshrc, zsh opens its first-run configuration
# wizard on startup, and the wizard *consumes keystrokes* — the first character
# typed into a pane vanished into it ("echo" arrived at the shell as "cho").
# Four panes each start a login shell, so all four would open the wizard.
#
# This lands in the named home volume too: Docker seeds an empty named volume
# from the image's contents at the mount point when it is first created.
RUN printf '%s\n' \
      '# Seeded by the image so zsh-newuser-install never runs. Yours to edit;' \
      '# it lives in the home volume and survives a recreate.' \
      'HISTFILE=~/.zsh_history' \
      'HISTSIZE=10000' \
      'SAVEHIST=10000' \
      'setopt inc_append_history share_history' \
      'autoload -Uz compinit && compinit -u' \
      "PROMPT='%~ %# '" \
    > /home/node/.zshrc \
 && chown node:node /home/node/.zshrc

WORKDIR /app

# Dependencies first, so a source-only change does not trigger another node-pty
# compile. `npm ci` and not `npm install`: the lockfile is the contract, and the
# vendored WASM parity test asserts the committed binary matches the resolved
# @wterm/ghostty version.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `npm start` runs tsx against server.ts, so devDependencies stay installed and
# there is nothing to prune. The build is still required: app/page.tsx is
# force-dynamic, but the rest of the Next output is not built at runtime.
RUN npm run build && chown -R node:node /app

USER node

# Overridden by compose. Loopback would bind this namespace's loopback, which
# nothing outside the container can reach.
ENV HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

# Hits the real page rather than a stub route, so a broken render fails the
# check. --fail turns a 5xx into a non-zero exit.
# Shell form, so $PORT is expanded at runtime: a hardcoded 3000 would leave the
# container permanently unhealthy if PORT were changed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl --fail --silent --output /dev/null "http://127.0.0.1:${PORT}/" || exit 1

CMD ["npm", "start"]
