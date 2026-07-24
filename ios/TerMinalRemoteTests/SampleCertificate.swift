/// A real self-signed X.509 certificate used only as a test fixture. Generated
/// once with: openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=TerMinal
/// -days 36500. It has no private key here and secures nothing.
enum SampleCertificate {
    static let der = """
        MIICpDCCAYwCCQDP1hZ2r7vQADANBgkqhkiG9w0BAQsFADATMREwDwYDVQQDDAhUZXJNaW5hbDAgFw0yNjA3MjEx
        NDU4NDRaGA8yMTI2MDYyNzE0NTg0NFowEzERMA8GA1UEAwwIVGVyTWluYWwwggEiMA0GCSqGSIb3DQEBAQUAA4IB
        DwAwggEKAoIBAQC6oASz0V+k6Mxrt/rDoYlTvYmBipbKULLTR7nF9ft3ND39reXmHA2YDvzOWMktxiIxtOeZQy98
        GER8OtFnuxvyU2g5Dh4aIAOYsGcFm4HAZxENs/rFEFUrAaLRLlXFBmMoQu/Ltn29B6/ftGQPkO52KKC9A3LeEzJH
        xkkSKzlLiT1HIBYJklyB8ZYUzgW+1WXPUkNru66B4QeOcF9yGf0BmwhtNZpYb84kDozqWyTfJbf6uqS96sKagxWT
        YjDagr5eGOiu7mBPvBqObwSg7WEfslH4q9Xx8ceg6uAEGLM+RJsickmgUFmauFv4leF81efMgeP6v6WsIumxNrgT
        q2KVAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAE3MQrPbXYC6c/CVhf/oTLdQ7gJBM6lSw5ovgN0pSzukfIqAlhj8
        2RMN/3KgAqvB3NT4MKzjPbTE820txaP9BlZO8dURA6vk+jwBUMyyY07jj7plwv+qOodjRsRnf9iGt2CXZIBg4YCB
        RqcqoAht0QP4vQaZT4zCCNDNQJ1rK3aXR3UgmkDVGum/u5zMpfcFDuOBSoWFu5XT1aOEDbh0HZm+VnFuBoIS/9wd
        tvtkwdjf5vv8nEkg85MVNdiyc5XFr7Qq/1SqVesfTgYYan7H9NDW1J4tn2bXnVrhdUu0I1bxszXYEWlD+aIhEkco
        oWjSu2mZsgA68P7UB3BjNRziVNE=
        """
}
