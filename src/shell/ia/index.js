// Herramientas de IA de los módulos propios de Citas (a mano en citas.js, declarativas en control.js). Las de los módulos centrales llegan de
// Diwilo Modulos (src/shell/lib/central.js → centralTools) y mcp.js las une.
import citas from './citas.js';
import control from './control.js';

export const TOOLS = [...citas, ...control];
