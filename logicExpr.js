// Minimal safe logical expression evaluator for prerequisites
// Supports: &&, ||, parentheses, and variable names (option IDs)
// Usage: evaluatePrereqExpr(expr, lookupFn)

function evaluatePrereqExpr(expr, lookupFn) {
    // Replace all option IDs with their boolean value from lookupFn
    // Only allow variable names, &&, ||, (, ), whitespace
    // e.g. "angelSpecies && (demonSpecies || foo)"
    const safeExpr = expr.replace(/([a-zA-Z_][a-zA-Z0-9_]*)/g, (id) => lookupFn(id) ? 'true' : 'false');
    // Only allow safe characters
    if (/[^truefals()&|! \t]/.test(safeExpr.replace(/true|false/g, ''))) {
        throw new Error('Unsafe characters in prerequisite expression');
    }
    // Evaluate using Function constructor (safe after replacement)
    // eslint-disable-next-line no-new-func
    return Function('return (' + safeExpr + ')')();
}

// Export for browser
if (typeof window !== 'undefined') {
    window.evaluatePrereqExpr = evaluatePrereqExpr;
}
