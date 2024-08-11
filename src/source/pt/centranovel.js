const MangaStream = require('@/template/MangaStream');

class CentralNovelProvider extends MangaStream {
    constructor() {
        super('centralnovel', 'https://centralnovel.com/');
        this.searchUrl = `${this.baseUrl}?s=%s`;
    }
}

module.exports = new CentralNovelProvider();