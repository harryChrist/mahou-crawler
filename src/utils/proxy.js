const fs = require('fs');
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXIES_FILE = path.join(__dirname, '..', '..', 'data', 'proxies.json');
// Endpoint gratuito de lista de proxies — trocável via env var, já que listas
// públicas mudam/saem do ar com frequência e não queremos precisar editar código.
const FALLBACK_PROXY_LIST_URL = process.env.PROXY_LIST_URL
    || 'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all';

// Se WEBSHARE_API_KEY estiver setada, usa os proxies da conta Webshare (dedicados,
// bem mais confiáveis) como fonte de fallback em vez da lista pública genérica.
const WEBSHARE_API_KEY = process.env.WEBSHARE_API_KEY;
const WEBSHARE_LIST_URL = 'https://proxy.webshare.io/api/v2/proxy/list/';
const WEBSHARE_PAGE_SIZE = 100;
const WEBSHARE_MAX_PROXIES = 1000; // trava de segurança contra paginação infinita

const DEFAULT_MAX_ATTEMPTS = 4;                    // 1 tentativa + 3 trocas de proxy
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;          // proxies grátis costumam ser lentos
const DEFAULT_DEAD_COOLDOWN_MS = 10 * 60 * 1000;   // 10min fora de rotação após falhar
const MIN_FALLBACK_REFETCH_INTERVAL_MS = 2 * 60 * 1000; // não martela a API pública

// Proxy é opt-in por chamada (useProxy: true) — nenhum request/browser é afetado
// por padrão. Carregamento é 100% preguiçoso: nada toca disco/rede no require().
class ProxyManager {
    constructor() {
        this._staticList = null;      // carregado sob demanda, não no construtor
        this._fallbackList = [];
        this._deadUntil = new Map();  // "host:port" -> timestamp de expiração
        this._pointer = 0;
        this._lastFallbackFetch = 0;
    }

    _loadStaticList() {
        try {
            return JSON.parse(fs.readFileSync(PROXIES_FILE, 'utf-8'));
        } catch {
            return []; // arquivo ausente ou JSON inválido -> lista vazia, sem crashar
        }
    }

    async _fetchFallbackList() {
        try {
            const { data } = await axios.get(FALLBACK_PROXY_LIST_URL, { timeout: 10000 });
            const text = typeof data === 'string' ? data : JSON.stringify(data);

            return text
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean)
                .map(line => {
                    const match = line.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
                    if (!match) return null;
                    return { host: match[1], port: parseInt(match[2], 10), protocol: 'http' };
                })
                .filter(Boolean);
        } catch (error) {
            console.error('Erro ao buscar lista de proxies de fallback:', error.message);
            return [];
        }
    }

    // Proxies da própria conta Webshare (dedicados, não compartilhados com o mundo
    // inteiro como as listas públicas grátis). Pagina até acabar ou até o teto de
    // segurança. Retorna [] em erro/sem proxy válido — quem chama decide o que fazer.
    async _fetchWebshareList() {
        try {
            const results = [];
            let page = 1;

            while (results.length < WEBSHARE_MAX_PROXIES) {
                const { data } = await axios.get(WEBSHARE_LIST_URL, {
                    params: { mode: 'direct', page, page_size: WEBSHARE_PAGE_SIZE },
                    headers: { Authorization: `Token ${WEBSHARE_API_KEY}` },
                    timeout: 10000,
                });

                results.push(...data.results
                    .filter(r => r.valid)
                    .map(r => ({
                        host: r.proxy_address,
                        port: r.port,
                        protocol: 'http',
                        username: r.username,
                        password: r.password,
                    })));

                if (!data.next) break;
                page++;
            }

            return results;
        } catch (error) {
            console.error('Erro ao buscar lista de proxies da Webshare:', error.message);
            return [];
        }
    }

    // Webshare primeiro (se configurada) — proxy dedicado da conta, muito mais
    // confiável. Só cai pra lista pública genérica se não tiver chave ou a Webshare
    // não devolver nenhum proxy válido.
    async _fetchRemoteList() {
        if (WEBSHARE_API_KEY) {
            const webshareProxies = await this._fetchWebshareList();
            if (webshareProxies.length > 0) return webshareProxies;
            console.error('Webshare não retornou proxies válidos, caindo pra lista pública.');
        }
        return this._fetchFallbackList();
    }

    async _ensureLoaded() {
        if (this._staticList === null) {
            this._staticList = this._loadStaticList();
        }
    }

    _proxyKey(proxy) {
        return `${proxy.host}:${proxy.port}`;
    }

    _isAlive(proxy) {
        return (this._deadUntil.get(this._proxyKey(proxy)) || 0) <= Date.now();
    }

    markDead(proxy, cooldownMs = DEFAULT_DEAD_COOLDOWN_MS) {
        this._deadUntil.set(this._proxyKey(proxy), Date.now() + cooldownMs);
    }

    async _nextProxy() {
        await this._ensureLoaded();
        let pool = [...this._staticList, ...this._fallbackList].filter(p => this._isAlive(p));

        if (pool.length === 0 && Date.now() - this._lastFallbackFetch > MIN_FALLBACK_REFETCH_INTERVAL_MS) {
            this._lastFallbackFetch = Date.now();
            this._fallbackList = await this._fetchRemoteList();
            pool = this._fallbackList.filter(p => this._isAlive(p));
        }

        if (pool.length === 0) return null;

        this._pointer = (this._pointer + 1) % pool.length;
        return pool[this._pointer];
    }

    _buildHttpsAgent(proxy) {
        const auth = proxy.username ? `${proxy.username}:${proxy.password || ''}@` : '';
        const url = `${proxy.protocol || 'http'}://${auth}${proxy.host}:${proxy.port}`;
        return new HttpsProxyAgent(url);
    }

    // Passthrough puro quando useProxy é false — zero mudança de comportamento
    // pros call sites que nunca vão pedir proxy.
    async axiosRequest(config, { useProxy = false, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
        if (!useProxy) return axios(config);

        let lastError;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const proxy = await this._nextProxy();
            if (!proxy) throw lastError || new Error('Nenhum proxy disponível');

            try {
                const agent = this._buildHttpsAgent(proxy);
                return await axios({
                    ...config,
                    httpsAgent: agent,
                    httpAgent: agent,
                    proxy: false, // evita conflito com detecção automática de env var do axios
                    timeout: config.timeout || DEFAULT_REQUEST_TIMEOUT_MS,
                });
            } catch (error) {
                lastError = error;
                this.markDead(proxy);
            }
        }
        throw lastError;
    }

    // Puppeteer: proxy é baked-in no launch, não dá pra trocar a meio da sessão —
    // por isso o retry aqui relança o browser inteiro com o próximo proxy.
    async launchBrowser(launchOptions = {}, { useProxy = false, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
        if (!useProxy) return { browser: await puppeteer.launch(launchOptions), proxy: null };

        let lastError;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const proxy = await this._nextProxy();
            if (!proxy) throw lastError || new Error('Nenhum proxy disponível');

            let browser;
            try {
                browser = await puppeteer.launch({
                    ...launchOptions,
                    args: [...(launchOptions.args || []), `--proxy-server=${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`],
                });

                // Verificação ativa: sem isso, um proxy morto só apareceria no meio
                // do scraping de verdade, com o browser já "aberto" e sem avisar.
                const page = await browser.newPage();
                if (proxy.username) await page.authenticate({ username: proxy.username, password: proxy.password || '' });
                await page.goto('https://example.com', { timeout: 20000 });
                await page.close();

                return { browser, proxy }; // devolve proxy p/ autenticar outras páginas abertas depois
            } catch (error) {
                lastError = error;
                this.markDead(proxy);
                if (browser) {
                    try { await browser.close(); } catch { /* já morreu */ }
                }
            }
        }
        throw lastError;
    }
}

module.exports = new ProxyManager();
