export default {
  async fetch(request, env, ctx) {
    const res = await fetch('https://api.geckoterminal.com/api/v2/search/pools?query=eth');
    return new Response(await res.text(), { status: res.status });
  }
}
