#!/usr/bin/env bash
# Sobe a versão do app em TODOS os lugares de uma vez (evita esquecer algum e travar o cache).
#   uso: ./bump.sh 36
set -e
V="$1"
if [ -z "$V" ]; then echo "uso: ./bump.sh <numero>  (ex.: ./bump.sh 36)"; exit 1; fi

# 1) src/constants.ts — versão mostrada no menu/login
sed -i -E "s/APP_VERSION = 'v[0-9]+';/APP_VERSION = 'v$V';/" src/constants.ts
# 2) sw.js — nome do cache (força o service worker novo a instalar)
sed -i -E "s/edna-relatorio-v[0-9]+/edna-relatorio-v$V/" sw.js
# 3) sw.js — URLs versionadas dos assets (só o entry point precisa; os demais módulos
#    são invalidados pela troca do nome do cache acima)
sed -i -E "s#\./styles\.css\?v=[0-9]+#./styles.css?v=$V#" sw.js
sed -i -E "s#\./build/main\.js\?v=[0-9]+#./build/main.js?v=$V#" sw.js
# 4) index.html — URLs versionadas (URL nova = navegador OBRIGADO a rebaixar; fura o cache HTTP)
sed -i -E "s#styles\.css\?v=[0-9]+#styles.css?v=$V#" index.html
sed -i -E "s#build/main\.js\?v=[0-9]+#build/main.js?v=$V#" index.html

echo "versão v$V aplicada em:"
grep -n "APP_VERSION = " src/constants.ts
grep -n "CACHE = \|styles.css?v=\|build/main.js?v=" sw.js
grep -n "styles.css?v=\|build/main.js?v=" index.html
