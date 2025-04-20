const MangaStream = require('@/template/MangaStream');

class CentraNovelProvider extends MangaStream {
    constructor() {
        super('centranovel', 'https://centranovel.com', 'novel');
        this.searchUrl = `${this.baseUrl}/novels?titulo=%s`;
    }
}

module.exports = new CentraNovelProvider();