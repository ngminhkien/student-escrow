using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StudentEscrow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RiskAssessmentsAndBlockTime : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "OrderDraft",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "Timestamp",
                table: "ChainBlock",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "RiskAssessment",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DraftId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Score = table.Column<int>(type: "int", nullable: true),
                    Level = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ScoringSource = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ModelVersion = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    FeatureVersion = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    DataSource = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    FeaturesJson = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    EvaluatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RiskAssessment", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RiskAssessment_OrderDraft_DraftId",
                        column: x => x.DraftId,
                        principalTable: "OrderDraft",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RiskAssessment_DraftId_EvaluatedAt",
                table: "RiskAssessment",
                columns: new[] { "DraftId", "EvaluatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RiskAssessment");

            migrationBuilder.DropColumn(
                name: "Category",
                table: "OrderDraft");

            migrationBuilder.DropColumn(
                name: "Timestamp",
                table: "ChainBlock");
        }
    }
}
