from __future__ import annotations

import getpass
import re
import sys
from contextlib import closing

from mysql.connector import IntegrityError

from server import connect_db, normalized_email, password_hash, require_text


def main() -> int:
    email_input = input("Owner email: ").strip()
    try:
        email = normalized_email(email_input)
        name = require_text(input("Owner name: "), "Name", 120)
        password = getpass.getpass("Owner password (minimum 10 characters): ")
        if len(password) < 10:
            raise ValueError("Password must contain at least 10 characters.")
        if getpass.getpass("Confirm password: ") != password:
            raise ValueError("Passwords do not match.")
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    with closing(connect_db()) as connection:
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO users (email, name, password_hash, role) VALUES (%s, %s, %s, 'owner')",
                    (email, name, password_hash(password)),
                )
            connection.commit()
        except IntegrityError:
            connection.rollback()
            print("An account already uses that email address.", file=sys.stderr)
            return 2
    print(f"Owner account created for {email}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
