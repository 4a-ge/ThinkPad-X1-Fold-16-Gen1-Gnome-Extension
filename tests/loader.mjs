export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('gi://'))
        return {url: new URL('./stubs/' + specifier.slice(5) + '.mjs', import.meta.url).href, shortCircuit: true};
    if (specifier.startsWith('resource:///'))
        return {url: new URL('./stubs/' + specifier.split('/').pop(), import.meta.url).href, shortCircuit: true};
    return nextResolve(specifier, context);
}
