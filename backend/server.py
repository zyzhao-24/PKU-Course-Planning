#!/usr/bin/env python3
import os
import sys
import stat
import socket
from pathlib import Path

# 路径配置
BASE_DIR = Path(__file__).parent.resolve()
CERT_DIR = BASE_DIR / "cert"
CERT_PATH = CERT_DIR / "cert.pem"
KEY_PATH = CERT_DIR / "key.pem"

from app import app, db


def get_local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except:
        return "127.0.0.1"


def generate_cert():
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import datetime, ipaddress

    CERT_DIR.mkdir(exist_ok=True)
    print("Generating SSL certificate...")

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    local_ip = get_local_ip()

    san_list = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
    ]
    if local_ip != "127.0.0.1":
        san_list.append(x509.IPAddress(ipaddress.IPv4Address(local_ip)))
    
    san = x509.SubjectAlternativeName(san_list)

    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(x509.NameOID.COMMON_NAME, "localhost")]))
        .issuer_name(x509.Name([x509.NameAttribute(x509.NameOID.COMMON_NAME, "localhost")]))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow())
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=365))
        .add_extension(san, critical=False)
        .sign(key, hashes.SHA256())
    )

    KEY_PATH.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
    CERT_PATH.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    # 设置私钥文件权限为仅当前用户可读写 (0o600)
    try:
        os.chmod(KEY_PATH, stat.S_IREAD | stat.S_IWRITE)
    except Exception:
        pass
    print(f"✓ Certificate saved to {CERT_DIR}")


def ensure_cert():
    if not CERT_PATH.exists() or not KEY_PATH.exists():
        generate_cert()


def main():
    with app.app_context():
        db.create_all()

    ensure_cert()

    local_ip = get_local_ip()
    print(f"\n{'='*60}")
    print("Course Planning System Server")
    print(f"{'='*60}")
    print(f"\nhttps://localhost:5000")
    print(f"https://{local_ip}:5000")
    print(f"\n{'='*60}\n")

    from gevent.pywsgi import WSGIServer
    WSGIServer(("0.0.0.0", 5000), app, keyfile=str(KEY_PATH), certfile=str(CERT_PATH)).serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nServer stopped.")
    except Exception as e:
        Path(BASE_DIR / "server_error.log").write_text(__import__("traceback").format_exc())
        print(f"Error: {e}")
        if sys.stdin.isatty():
            input("Press Enter to exit...")