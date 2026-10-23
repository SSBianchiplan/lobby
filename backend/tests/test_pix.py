from app.pix import br_code, crc16


def test_crc16_known_vector():
    # vetor clássico CRC-16/CCITT-FALSE
    assert crc16("123456789") == "29B1"


def test_br_code_structure():
    code = br_code("padellobby@gmail.com", 12000, "Padel Lobby", "Rio Grande", "PL-ABC12XYZ")
    assert code.startswith("000201")
    assert "br.gov.bcb.pix" in code
    assert "5406120.00" in code
    assert "5303986" in code and "5802BR" in code
    assert code[-8:-4] == "6304"
    assert crc16(code[:-4]) == code[-4:]
