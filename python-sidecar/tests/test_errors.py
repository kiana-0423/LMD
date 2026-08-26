import json

from lmd_sidecar.main import main
from lmd_sidecar.utils.errors import classify_error


def test_training_error_has_a_stable_code_and_keeps_detail():
    error = classify_error("train-model", ValueError("At least three rows are required."))

    assert error.code == "model.trainingFailed"
    assert error.detail == "At least three rows are required."
    assert error.params == {"command": "train-model"}


def test_missing_prediction_model_has_the_specific_file_code():
    error = classify_error("predict-with-model", FileNotFoundError("model.joblib is missing"))

    assert error.code == "model.fileMissing"


def test_missing_payload_field_is_invalid_input():
    error = classify_error("standardize", KeyError("smiles"))

    assert error.code == "sidecar.invalidInput"


def test_cli_writes_the_structured_error_envelope(tmp_path, capsys):
    input_path = tmp_path / "input.json"
    input_path.write_text("{}", encoding="utf-8")

    exit_code = main(["unsupported-command", "--input", str(input_path)])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert output["ok"] is False
    assert output["error"]["code"] == "sidecar.invalidInput"
    assert output["error"]["params"] == {"command": "unsupported-command"}
    assert "Unsupported command" in output["error"]["detail"]
