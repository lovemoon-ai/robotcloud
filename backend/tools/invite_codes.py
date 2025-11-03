from __future__ import annotations

import argparse
import sys
from backend.app.database import InvitationCode, create_database


def format_invitation(invitation: InvitationCode) -> str:
    used_at = invitation.used_at.isoformat() if invitation.used_at else "-"
    return (
        f"{invitation.code} | used={invitation.used} | "
        f"created_at={invitation.created_at.isoformat()} | used_at={used_at} | "
        f"user_id={invitation.assigned_user_id or '-'} | "
        f"phone={invitation.assigned_phone or '-'} | note={invitation.note or '-'}"
    )


def handle_list(show_used: bool) -> None:
    db = create_database()
    invitations = db.list_invitation_codes()
    if not invitations:
        print("No invitation codes found.")
        return
    shown = False
    for invitation in sorted(invitations, key=lambda item: item.created_at, reverse=True):
        if not show_used and invitation.used:
            continue
        shown = True
        print(format_invitation(invitation))
    if not shown:
        print("No invitation codes found.")


def handle_create(code: str, note: str | None) -> None:
    db = create_database()
    invitation = db.add_invitation_code(code, note)
    print(f"Created invitation code: {format_invitation(invitation)}")


def handle_generate(prefix: str, length: int, note: str | None) -> None:
    db = create_database()
    invitation = db.generate_invitation_code(prefix=prefix, length=length, note=note)
    print(f"Generated invitation code: {format_invitation(invitation)}")


def handle_show(code: str) -> None:
    db = create_database()
    invitation = db.get_invitation_code(code)
    if invitation is None:
        print(f"Invitation code '{code}' not found.", file=sys.stderr)
        sys.exit(1)
    print(format_invitation(invitation))


def handle_update(code: str, note: str | None) -> None:
    db = create_database()
    invitation = db.update_invitation_code(code, note)
    print(f"Updated invitation code: {format_invitation(invitation)}")


def handle_delete(code: str) -> None:
    db = create_database()
    db.delete_invitation_code(code)
    print(f"Deleted invitation code '{code}'.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage invitation codes.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="List invitation codes")
    list_parser.add_argument("--show-used", action="store_true", help="Include used invitation codes")

    create_parser = subparsers.add_parser("create", help="Create a new invitation code")
    create_parser.add_argument("code", help="Invitation code value")
    create_parser.add_argument("--note", help="Optional note for the invitation code")

    generate_parser = subparsers.add_parser("generate", help="Generate a random invitation code")
    generate_parser.add_argument("--prefix", default="INV", help="Prefix for the generated code (default: INV)")
    generate_parser.add_argument(
        "--length",
        type=int,
        default=8,
        help="Length of the random segment of the code (default: 8)",
    )
    generate_parser.add_argument("--note", help="Optional note for the invitation code")

    show_parser = subparsers.add_parser("show", help="Show invitation code details")
    show_parser.add_argument("code", help="Invitation code to display")

    update_parser = subparsers.add_parser("update", help="Update an invitation code note")
    update_parser.add_argument("code", help="Invitation code to update")
    update_parser.add_argument("--note", required=True, help="Note value to set")

    delete_parser = subparsers.add_parser("delete", help="Delete an invitation code")
    delete_parser.add_argument("code", help="Invitation code to delete")

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "list":
        handle_list(args.show_used)
    elif args.command == "create":
        handle_create(args.code, args.note)
    elif args.command == "generate":
        handle_generate(args.prefix, args.length, args.note)
    elif args.command == "show":
        handle_show(args.code)
    elif args.command == "update":
        handle_update(args.code, args.note)
    elif args.command == "delete":
        handle_delete(args.code)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
