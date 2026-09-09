# Aula UAS — Android APK

Aplicación Android de Aula UAS (A1/A3, A2, STS y Radiofonista UAS).

## Generar el APK desde GitHub

1. Abre **Actions**.
2. Selecciona **Build Aula UAS APK**.
3. Pulsa **Run workflow**.
4. Cuando termine, abre la ejecución y descarga el artefacto **Aula-UAS-APK**.
5. Dentro encontrarás `Aula-UAS-debug.apk`.

El workflow reconstruye `index.html` a partir de `app/src/main/assets/index.source.html`, descarga los manuales oficiales enlazados por la propia aplicación y los incrusta antes de compilar. De este modo el APK final conserva los manuales sin conexión sin guardar decenas de MB de PDF codificado en Base64 dentro del repositorio.

## Actualizar la aplicación

Sustituye `app/src/main/assets/index.source.html` por la nueva versión preparada para GitHub y haz commit. El workflow se ejecutará automáticamente.
