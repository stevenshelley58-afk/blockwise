# Australian postcode coordinate source

`nearby-postcodes-au.ts` is a generated, runtime-local subset of GeoNames'
Australian postal-code export: <https://download.geonames.org/export/zip/AU.zip>.
It was downloaded on 2026-09-14. No network request is made by the application.

GeoNames licenses this export under Creative Commons Attribution 4.0
International. Attribution: **GeoNames** (<https://www.geonames.org/>), Australian
postal-code export. The licence text is retained in `GEONAMES-CC-BY-4.0.txt`.

## Selection method and limits

The source has one or more locality coordinates for a postcode. This file keeps
only source rows with GeoNames coordinate accuracy 4 or greater. A postcode is
kept only when every retained source locality lies within 15 km of every other
retained locality. Its coordinate is one actual source locality point: the
medoid, chosen by the smallest total distance to the other retained points.

This deliberately excludes postcodes that span distant localities rather than
inventing a centroid for a large rural or remote area. A retained coordinate is
still an approximate locality reference, not a boundary or a Meta targeting
key. The resolver therefore caps results by straight-line distance, always
includes the requested exact postcode first, and falls back to exact-only when
there is no retained coordinate.
