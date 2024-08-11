function getFullUrl(url) {
    if (url.startsWith("http")) {
        return url;
    }
    if (url.startsWith("/")) {
        return this.baseUrl + url;
    }
    return this.baseUrl + "/" + url;
}

export default getFullUrl;