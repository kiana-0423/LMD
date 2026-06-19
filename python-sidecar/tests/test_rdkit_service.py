from lmd_sidecar.services.rdkit_service import safe_import_rdkit, validate_smiles


def test_validate_smiles_accepts_valid_smiles():
    result, warnings = validate_smiles("CCO")
    assert result["valid"] is True
    assert warnings == []
    assert result["smiles_canonical"]


def test_validate_smiles_rejects_invalid_smiles():
    result, warnings = validate_smiles("not-a-smiles")
    assert result["valid"] is False
    assert warnings == []
    assert result["error"]


def test_safe_import_rdkit_returns_structured_status():
    result = safe_import_rdkit()
    assert "ok" in result
    if result["ok"]:
        assert "Chem" in result
    else:
        assert "error" in result
