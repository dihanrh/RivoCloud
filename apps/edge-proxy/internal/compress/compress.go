package compress

import (
	"bytes"
	"compress/gzip"
	"strings"
)

// Compressible content types, per EDD Section 5.7. Brotli is intentionally
// not implemented this stage (Month 2 task list: "gzip compression (skip
// brotli until Month 4)").
var compressibleTypes = map[string]bool{
	"text/html":              true,
	"text/css":               true,
	"text/plain":             true,
	"application/javascript": true,
	"application/json":       true,
	"application/xml":        true,
}

func IsCompressible(contentType string) bool {
	ct := contentType
	if i := strings.IndexByte(ct, ';'); i != -1 {
		ct = ct[:i]
	}
	return compressibleTypes[strings.ToLower(strings.TrimSpace(ct))]
}

func AcceptsGzip(acceptEncoding string) bool {
	for _, enc := range strings.Split(acceptEncoding, ",") {
		enc = strings.TrimSpace(enc)
		if i := strings.IndexByte(enc, ';'); i != -1 {
			enc = enc[:i]
		}
		if strings.EqualFold(strings.TrimSpace(enc), "gzip") {
			return true
		}
	}
	return false
}

func Gzip(body []byte) ([]byte, error) {
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	if _, err := gw.Write(body); err != nil {
		return nil, err
	}
	if err := gw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
