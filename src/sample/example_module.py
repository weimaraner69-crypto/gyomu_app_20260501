"""Spec-Driven Development のサンプルモジュール。

このファイルは以下のベストプラクティスを示す教材である:

1. **型アノテーション**: すべての関数引数・戻り値に型を付与し、mypy strict に準拠する
2. **Design by Contract**: docstring に事前条件・事後条件・不変条件を明記する
3. **アサーション**: 実行時に契約違反を即座に検出する防御的プログラミング

プロジェクトのドメインに合わせてカスタマイズすること:
  - ``ExampleEntity`` をドメインのエンティティ名に変更する
  - ``process()`` をドメインのビジネスロジックに置き換える
  - docstring の契約記述パターンはそのまま踏襲する
"""

from dataclasses import dataclass

# ---------------------------------------------------------------------------
# データクラス: ドメインエンティティのサンプル
# ---------------------------------------------------------------------------


# CUSTOMIZE: ExampleEntity をプロジェクトのドメインエンティティ名に変更すること。
#   例: Order, Task, Document, Measurement など。
#   不変条件のアサーション（__post_init__）もドメインに合わせて調整する。
@dataclass
class ExampleEntity:
    """ドメインエンティティのサンプルデータクラス。

    このクラスは Spec-Driven Development における **不変条件（Invariant）** の
    記述方法を示す。``__post_init__`` でアサーションを配置し、
    インスタンス生成時に不変条件を強制する。

    不変条件 (Invariant):
        - ``value`` は 0.0 以上であること
        - ``name`` は空文字列ではないこと

    Attributes:
        name: エンティティの識別名。空文字列は許可しない。
        value: エンティティの数値。0.0 以上であること。

    Raises:
        AssertionError: 不変条件に違反した場合。

    Example::

        entity = ExampleEntity(name="sample", value=10.0)  # OK
        entity = ExampleEntity(name="", value=10.0)         # AssertionError
        entity = ExampleEntity(name="sample", value=-1.0)   # AssertionError
    """

    name: str
    value: float

    def __post_init__(self) -> None:
        """不変条件を検証する。

        インスタンス生成時に自動的に呼び出され、
        すべてのフィールドが不変条件を満たしているかを確認する。
        """
        assert self.value >= 0.0, f"value must be >= 0.0, got {self.value}"
        assert self.name, "name must not be empty"


# ---------------------------------------------------------------------------
# ビジネスロジック関数: 契約付き処理のサンプル
# ---------------------------------------------------------------------------


# CUSTOMIZE: process() をプロジェクトのビジネスロジックに置き換えること。
#   事前条件・事後条件のパターンはそのまま踏襲する。
def process(entity: ExampleEntity, multiplier: float) -> float:
    """エンティティの value に multiplier を適用し結果を返す。

    この関数は **事前条件（Precondition）** と **事後条件（Postcondition）** の
    記述方法を示す。アサーションで契約を実行時にも検証する。

    事前条件 (Precondition):
        - ``multiplier`` は 0.0 より大きいこと

    事後条件 (Postcondition):
        - 戻り値は 0.0 以上であること

    Args:
        entity: 処理対象のエンティティ。
        multiplier: 乗数。0.0 より大きいこと。

    Returns:
        ``entity.value * multiplier`` の計算結果（0.0 以上）。

    Raises:
        AssertionError: 事前条件または事後条件に違反した場合。

    Example::

        entity = ExampleEntity(name="item", value=5.0)
        result = process(entity, 2.0)  # -> 10.0
    """
    # --- 事前条件の検証 ---
    assert multiplier > 0.0, f"multiplier must be > 0.0, got {multiplier}"

    # --- ビジネスロジック ---
    result = entity.value * multiplier

    # --- 事後条件の検証 ---
    assert result >= 0.0, f"postcondition failed: result={result}"

    return result
