using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudentEscrow.Infrastructure.Persistence.Migrations
{
    public partial class WalletProofAndMockKyc : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WalletChallenges",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Address = table.Column<string>(type: "nvarchar(42)", maxLength: 42, nullable: false),
                    ChainId = table.Column<long>(type: "bigint", nullable: false),
                    Nonce = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Message = table.Column<string>(type: "nvarchar(2048)", maxLength: 2048, nullable: false),
                    IssuedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UsedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WalletChallenges", entity => entity.Id);
                    table.ForeignKey(
                        name: "FK_WalletChallenges_Users_UserId",
                        column: entity => entity.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WalletLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Address = table.Column<string>(type: "nvarchar(42)", maxLength: 42, nullable: false),
                    ChainId = table.Column<long>(type: "bigint", nullable: false),
                    LinkedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WalletLinks", entity => entity.Id);
                    table.ForeignKey(
                        name: "FK_WalletLinks_Users_UserId",
                        column: entity => entity.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "KycSubmissions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    WalletLinkId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FullName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    StudentNumber = table.Column<string>(type: "nvarchar(29)", maxLength: 29, nullable: false),
                    DocumentReference = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    SelfieReference = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ReasonCode = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    SubmittedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ReviewedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KycSubmissions", entity => entity.Id);
                    table.ForeignKey(
                        name: "FK_KycSubmissions_Users_UserId",
                        column: entity => entity.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_KycSubmissions_WalletLinks_WalletLinkId",
                        column: entity => entity.WalletLinkId,
                        principalTable: "WalletLinks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_KycSubmissions_UserId",
                table: "KycSubmissions",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_KycSubmissions_WalletLinkId",
                table: "KycSubmissions",
                column: "WalletLinkId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WalletChallenges_UserId_ExpiresAt",
                table: "WalletChallenges",
                columns: new[] { "UserId", "ExpiresAt" });

            migrationBuilder.CreateIndex(
                name: "IX_WalletLinks_Address",
                table: "WalletLinks",
                column: "Address",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WalletLinks_UserId",
                table: "WalletLinks",
                column: "UserId",
                unique: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "KycSubmissions");

            migrationBuilder.DropTable(
                name: "WalletChallenges");

            migrationBuilder.DropTable(
                name: "WalletLinks");
        }
    }
}
