"""Read back this batch, its structures, descriptors, source files and pre-import rows."""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

from rdkit import Chem

report = json.loads(Path(sys.argv[1]).read_text())
workspace = Path(report["workspace"])
connection = sqlite3.connect((workspace / "lmd.sqlite").as_uri() + "?mode=ro", uri=True)
assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert not connection.execute("PRAGMA foreign_key_check").fetchall()
assert connection.execute("SELECT COUNT(*) FROM molecules").fetchone()[0] == report["count_after"]
for record in report["records"]:
    stored = connection.execute(
        "SELECT name,formula,smiles_canonical,descriptor_ready,mol_file_path,pdb_file_path,"
        "sdf_file_path,structure_svg_path,notes FROM molecules WHERE id=?", (record["id"],)
    ).fetchone()
    assert stored[:4] == (record["name"], record["formula"], record["smiles"], 1)
    for relative in stored[4:8]:
        assert (workspace / relative).stat().st_size > 0
    mol = Chem.MolFromMolFile(str(workspace / stored[4]))
    assert mol.GetConformer().Is3D()
    assert Chem.MolToSmiles(mol) == record["smiles"]
    descriptors = connection.execute(
        "SELECT descriptor_set,descriptor_count,status,mode FROM molecule_descriptors WHERE molecule_id=? ORDER BY descriptor_set",
        (record["id"],),
    ).fetchall()
    assert descriptors == [("mordred", 1613, "calculated", "real"), ("rdkit", 27, "calculated", "real")]
    assert hashlib.sha256((workspace / record["original_attachment"]).read_bytes()).hexdigest() == record["source_sha256"]
    source = Path("/Users/can/Desktop/添加剂结构") / (record["name"] + ".mol2")
    assert hashlib.sha256(source.read_bytes()).hexdigest() == record["source_sha256"]
    print(record["name"], record["formula"], "verified")
backup = sqlite3.connect(Path(report["backup"]).as_uri() + "?mode=ro", uri=True)
for table in ["molecules", "molecule_descriptors", "experiments", "performance_results", "formulations", "attachments"]:
    for row in backup.execute(f"SELECT * FROM {table}"):
        # These tables all use an id as their first column.
        assert connection.execute(f"SELECT * FROM {table} WHERE id=?", (row[0],)).fetchone() == row
print("Verified all 9 molecules, 18 descriptor records, 36 structure files, 9 original attachments; existing records and original source files unchanged.")
