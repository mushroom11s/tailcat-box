package chat

import "encoding/json"

func marshalJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}
