const cheerio = require('cheerio');
const axios = require('axios');

class BaseProvider {
    constructor(name, baseUrl) {
        this.name = name;
        this.baseUrl = baseUrl;
        this.cleaner = { badTags: [] };
    }

    slugifyString(text) {
        return text
            .toString()
            .replace(/\s+/g, '-') // Replace spaces with -
            .replace(/[^\w\-]+/g, '') // Remove all non-word chars
            .replace(/\-\-+/g, '-') // Replace multiple - with single -
            .replace(/^-+/, '') // Trim - from start of text
            .replace(/-+$/, ''); // Trim - from end of text
    }

    getPath = (url) => {
        const match = url.match(/https:\/\/centralnovel\.com([^?#]*)/);
        return match ? match[1] : null;
    }    

    getFullUrl(url) {
        if (url.startsWith("http")) {
            return url;
        }
        if (url.startsWith("/")) {
            return this.baseUrl + url;
        }
        return this.baseUrl + "/" + url;
    }

    async processImagesInContent(content) {
        const $ = cheerio.load(content);
    
        const promises = $('img').map(async function () {
            const img = $(this);
            const src = img.attr('src');
    
            if (src && !src.startsWith('data:') && (src.startsWith('http://') || src.startsWith('https://'))) {
                try {
                    // Faz o download da imagem
                    const response = await axios({
                        url: src,
                        method: 'GET',
                        responseType: 'arraybuffer'
                    });
    
                    // Converte a imagem para base64
                    const base64Image = `data:${response.headers['content-type']};base64,${Buffer.from(response.data, 'binary').toString('base64')}`;
    
                    // Substitui o src pela versão base64
                    img.attr('src', base64Image);
                } catch (error) {
                    console.error(`Erro ao processar a imagem: ${src}`, error);
                }
            }
        }).get();
    
        await Promise.all(promises);
    
        return $('body').html();  // Retorna apenas o conteúdo dentro do body
    }

    // Métodos abstratos que devem ser implementados nas classes derivadas
    async searchNovel(query) {
        throw new Error('Method "searchNovel" should be implemented');
    }

    async readNovelInfo() {
        throw new Error('Method "readNovelInfo" should be implemented');
    }

    async downloadChapterBody(url) {
        throw new Error('Method "downloadChapterBody" should be implemented');
    }
}

module.exports = BaseProvider;
