# Superpowers en Burpy

Fuente: https://github.com/obra/superpowers
Versión: 6.4.2
Commit: 8ca22dba9a94f28898bbce59f2537ff4d87c747d
Licencia: MIT; ver LICENSE.

Se redistribuyen skills y sus recursos oficiales sin modificarlos, más README.md y package.json de procedencia. El runtime de integración de Burpy está en src/superpowers.js y src/provider.js. No se ejecutan hooks de otro host. El manifiesto fija hashes del contenido distribuido para detectar archivos modificados o incompletos. Este aviso es propio de la integración.

La adaptación mapea Skill a skill, TodoWrite a todowrite, preguntas a ask_questions y archivos/shell a las herramientas existentes. Burpy no proporciona subagentes ni navegador, por lo que comunica sus límites y utiliza la ruta de ejecución secuencial disponible. Los permisos y la cancelación de Burpy se mantienen. No hay garantía de calidad independiente del modelo.
