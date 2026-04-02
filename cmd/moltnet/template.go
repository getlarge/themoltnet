package main

import (
	"bytes"
	"text/template"
)

type templateData struct {
	JudgeSDK          string
	JudgeModelDefault string
}

func renderTemplate(tmpl *template.Template, data templateData) (string, error) {
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}
