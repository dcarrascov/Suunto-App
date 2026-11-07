# Contribuir

[English](CONTRIBUTING.md) · **Español**

¡Gracias por querer ayudar! Se agradecen los avisos de fallos, las ideas, las mejoras de la documentación y el código.

## Antes de empezar

- **Fallos e ideas:** abre una [issue](https://github.com/dimacavidv-lgtm/Suunto-App/issues). Para cambios grandes, ábrela antes para hablarlo, así nadie trabaja en balde.
- **Problemas de seguridad:** no publiques los detalles en una issue. Abre una diciendo solo que has encontrado un problema de seguridad, y acordaremos una forma privada de contarlo.

## Nunca compartas datos personales

La app maneja datos personales: entrenamientos, pulso, rutas GPS y claves de tus cuentas. En las issues, los pull requests, las capturas y los registros:

- Nunca incluyas `.env`, `public/data/`, `fetch/fit/` ni `fetch/debug/`, ni ninguna clave, cookie o sesión.
- Para un problema con los datos de Suunto, `python3 fetch/sync.py --dump latest` guarda una copia de un entrenamiento sin coordenadas ni usuario (`fetch/debug/<id>.redacted.json`). Es el único fichero que puedes compartir; los demás de esa carpeta contienen tu ruta.
- Para las capturas, usa la demo (`npm run demo`), que solo tiene datos inventados.

## Prepara el proyecto

```bash
git clone https://github.com/<tu-usuario>/Suunto-App.git   # tu fork
cd Suunto-App
npm install
python3 -m pip install -r fetch/requirements.txt
npm run demo
```

`npm run demo` abre la app con los datos inventados de `demo/data/`, así que no necesitas cuenta de Suunto ni claves. Para poner sus fechas al día: `python3 fetch/make_demo.py`. En Windows, usa `py` donde pone `python3`.

## Comprobaciones antes de un pull request

```bash
npx tsc -b
npx oxlint
npm test
python3 -m unittest discover -s fetch -p "test_*.py"
python3 fetch/validate_output.py --data demo/data
```

La integración continua pasa casi todas en cada pull request. Añade tests para la lógica nueva: `src/utils/*.test.ts`, `server/*.test.ts` o `fetch/test_*.py`.

## Convenciones del proyecto

- **Idioma:** la interfaz de la app y los comentarios del código van en español; los mensajes de commit, en inglés. Las issues y los pull requests pueden ir en inglés o en español.
- **Fechas en hora local:** `startTime` es una fecha ISO local, sin zona horaria. Nunca uses `toISOString()` para sacar un día: usa las funciones de `src/utils/date.ts`.
- **Una forma de los datos, tres sitios:** si cambias el formato de los datos, cambia a la vez `fetch/normalizer.py` (`make_summary()`), `src/types/suunto.ts` y `fetch/validate_output.py`.
- **Las claves se quedan en el servidor:** las rutas de `server/` las leen del `.env` y nunca llegan al navegador. Toda petición pasa antes por `server/auth.ts`: no añadas rutas que se lo salten. `.env.example` solo lleva valores de ejemplo.
- **Solo lectura con otros servicios:** la app nunca escribe en la cuenta de Suunto ni en la de TrainingPeaks, y nunca manda rutas GPS a la IA.
- **Diseño «Grafito»:** oscuro y plano, grises neutros y un solo color de acento lima (`#c5f23c`). Sin degradados, brillos ni emojis.

## Pull requests

1. Haz un fork del repositorio y crea una rama desde `main`: `fix/…` para correcciones y `feature/…` para funcionalidades nuevas.
2. Un cambio por pull request. Explica qué cambia y cómo lo has probado; las capturas de la demo ayudan.
3. Comprueba que pasan las comprobaciones de arriba.

Al contribuir, aceptas que tus contribuciones se publiquen con la [licencia MIT](LICENSE).
